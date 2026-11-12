# Backend/services/connectors/cdc_worker.py
"""
Event-Driven Change Data Capture (CDC) & Org-Hierarchy Reconciliation Worker.

Handles:
1. Webhook-triggered incremental delta syncs (`run_incremental_cdc_sync`)
   with Redis distributed locks, cursor persistence (`sync_cursor`),
   hard deletions (`is_deleted`), content updates, and permission diffs.
2. Periodic reconciliation polling (`reconcile_all_integrations_cdc`)
   for connectors without push webhooks or missed webhook windows.
3. Temporary role/share expiration sweep (`sweep_expired_role_assignments`).
4. Org/team membership & manager hierarchy change cache invalidation (`handle_org_membership_change`).
"""

import asyncio
import hashlib
import os
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import redis_client
from services.connectors.registry import ConnectorRegistry
from services.connectors.manager import (
    ConnectorManager,
    TEMP_DIR,
    BUCKET_NAME,
    sanitize_filename,
)
from ingestion.coach_store import create_document_record
from ingestion.coach_pipeline import run_coach_file_ingestion
from security.rebac import (
    sync_native_cloud_acls,
    recompute_document_acl,
    invalidate_company_security_cache,
    invalidate_user_security_cache,
)

supabase_admin = get_service_supabase_client()


async def run_incremental_cdc_sync(
    company_id: str,
    provider: str,
    integration_id: Optional[str] = None,
    force_full_on_cursor_error: bool = True,
) -> Dict[str, Any]:
    """
    Executes an incremental Change Data Capture (CDC) pass for an integration.
    Uses `fetch_incremental_changes` and advances `sync_cursor` per monitored source.
    """
    start_time = time.time()

    # Resolve target integration
    q = (
        supabase_admin.table("company_integrations")
        .select("*")
        .eq("company_id", company_id)
        .eq("provider", provider)
        .eq("status", "active")
    )
    if integration_id:
        q = q.eq("id", integration_id)
    res = q.order("updated_at", desc=True).limit(1).execute()
    integration = res.data[0] if (res and getattr(res, "data", None)) else None
    if not integration:
        return {"status": "skipped", "message": "No active integration found."}

    target_int_id = str(integration["id"])
    connected_user_id = integration.get("owner_user_id") or integration.get("connected_by")
    account_identifier = integration.get("account_identifier")

    # Distributed lock to coalesce bursty webhook notifications
    lock_key = f"lock:cdc:{target_int_id}"
    try:
        acquired = redis_client.set(lock_key, "1", nx=True, ex=45)
        if not acquired:
            return {
                "status": "coalesced",
                "integration_id": target_int_id,
                "message": "CDC sync already running for integration.",
            }
    except Exception:
        pass

    deleted_count = 0
    updated_count = 0
    synced_count = 0
    acl_updated_count = 0
    errors: List[Dict[str, Any]] = []

    try:
        sources_res = (
            supabase_admin.table("integration_monitored_sources")
            .select("*")
            .eq("integration_id", target_int_id)
            .execute()
        )
        sources = getattr(sources_res, "data", None) or []
        if not sources:
            return {"status": "skipped", "integration_id": target_int_id, "message": "No monitored sources."}

        connector = ConnectorRegistry.get(provider)
        access_token = await ConnectorManager.get_valid_access_token(
            company_id, provider, integration_id=target_int_id
        )

        # Pick first available sync cursor or run per-source delta
        monitored_ids = [s["source_id"] for s in sources if s.get("source_id")]
        first_src = sources[0]
        sync_cursor = first_src.get("sync_cursor") or (integration.get("config") or {}).get("last_page_token")
        drive_id = (first_src.get("metadata") or {}).get("drive_id")

        try:
            changed_items, new_cursor = await connector.fetch_incremental_changes(
                access_token=access_token,
                sync_cursor=sync_cursor,
                monitored_source_ids=monitored_ids,
                drive_id=drive_id,
            )
        except Exception as delta_err:
            print(f"[CDC] Delta fetch warning for {provider}/{target_int_id}: {delta_err}")
            if force_full_on_cursor_error:
                batch = await ConnectorManager.sync_company_files(
                    company_id=company_id,
                    provider=provider,
                    integration_id=target_int_id,
                )
                return batch.model_dump()
            raise

        # Fetch existing synced item records for this integration
        existing_res = (
            supabase_admin.table("integration_synced_items")
            .select("id, source_id, external_item_id, content_hash, coach_document_id, status, metadata")
            .eq("integration_id", target_int_id)
            .execute()
        )
        existing_by_ext_id: Dict[str, Dict[str, Any]] = {}
        for row in (getattr(existing_res, "data", None) or []):
            if row.get("status") != "deleted":
                existing_by_ext_id[row["external_item_id"]] = row

        for item in changed_items:
            try:
                existing = existing_by_ext_id.get(item.item_id)
                existing_doc_id = existing.get("coach_document_id") if existing else None

                # 1. Deletion / Removal event
                if item.is_deleted or item.change_type == "deleted":
                    if existing or existing_doc_id:
                        await ConnectorManager._purge_deleted_item(
                            company_id=company_id,
                            integration_id=target_int_id,
                            external_item_id=item.item_id,
                            coach_document_id=existing_doc_id,
                        )
                        deleted_count += 1
                    continue

                # 2. Check if content hash is unchanged -> reconcile ACLs only!
                if existing and existing.get("status") == "completed" and existing.get("content_hash") == item.content_hash:
                    prev_meta = existing.get("metadata") or {}
                    prev_acls = sorted(set(prev_meta.get("acl_emails") or []))
                    curr_acls = sorted(set(item.acl_emails or []))
                    prev_ext_acls = sorted(set(prev_meta.get("acl_external_ids") or prev_meta.get("member_ids") or []))
                    curr_ext_acls = sorted(set(item.acl_external_ids or []))
                    if existing_doc_id and (prev_acls != curr_acls or prev_ext_acls != curr_ext_acls or item.change_type == "permission_changed"):
                        sync_native_cloud_acls(
                            company_id=company_id,
                            provider=provider,
                            document_id=existing_doc_id,
                            acl_emails=item.acl_emails,
                            acl_external_ids=item.acl_external_ids,
                            owner_email=item.owner_email or account_identifier,
                            is_restricted_inheritance=item.is_restricted_inheritance,
                        )
                        new_meta = dict(prev_meta)
                        new_meta["acl_emails"] = curr_acls
                        new_meta["acl_external_ids"] = curr_ext_acls
                        supabase_admin.table("integration_synced_items").update({
                            "metadata": new_meta,
                            "synced_at": datetime.now(timezone.utc).isoformat(),
                        }).eq("id", existing["id"]).execute()
                        acl_updated_count += 1
                    continue

                # 3. New or modified content -> download & ingest
                content, clean_filename, ext = await connector.download_item(access_token, item)
                if not content:
                    continue

                file_size = len(content)
                file_sha = hashlib.sha256(content).hexdigest()
                is_update = existing is not None and bool(existing_doc_id)

                if is_update and existing_doc_id:
                    supabase_admin.table("coach_document_chunks").delete().eq("document_id", existing_doc_id).execute()
                    doc_record_id = existing_doc_id
                else:
                    doc_record_id = str(uuid.uuid4())

                clean_filename = sanitize_filename(clean_filename)
                safe_filename = sanitize_filename(f"{doc_record_id}_{clean_filename}")
                storage_path = f"{company_id}/{doc_record_id}/{clean_filename}"

                try:
                    supabase_admin.storage.from_(BUCKET_NAME).upload(
                        path=storage_path,
                        file=content,
                        file_options={"content-type": "application/octet-stream", "upsert": "true"},
                    )
                except Exception:
                    storage_path = f"local_storage/{safe_filename}"

                source_container = item.parent_container_id or first_src.get("source_id")

                if is_update and existing_doc_id:
                    supabase_admin.table("coach_uploaded_documents").update({
                        "file_name": clean_filename,
                        "file_size_bytes": file_size,
                        "file_hash": file_sha,
                        "storage_path": storage_path,
                        "indexing_status": "pending",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", existing_doc_id).execute()
                else:
                    doc_record = create_document_record(
                        company_id=company_id,
                        uploaded_by=connected_user_id,
                        file_name=clean_filename,
                        file_type=ext,
                        file_size_bytes=file_size,
                        storage_path=storage_path,
                        file_hash=file_sha,
                        target_employee_id=(item.metadata or {}).get("target_employee_id"),
                        manual_description=f"CDC-synced from {connector.display_name}",
                        source_integration_id=target_int_id,
                        source_container_id=source_container,
                        author_user_id=connected_user_id,
                    )
                    doc_record_id = doc_record["id"]

                os.makedirs(TEMP_DIR, exist_ok=True)
                temp_file_path = os.path.abspath(os.path.join(TEMP_DIR, safe_filename))
                with open(temp_file_path, "wb") as f:
                    f.write(content)
                try:
                    await asyncio.to_thread(
                        run_coach_file_ingestion,
                        file_path=temp_file_path,
                        document_id=doc_record_id,
                        company_id=company_id,
                        file_name=clean_filename,
                        file_type=ext,
                        target_employee_id=(item.metadata or {}).get("target_employee_id"),
                    )
                finally:
                    if os.path.exists(temp_file_path):
                        try:
                            os.remove(temp_file_path)
                        except Exception:
                            pass

                # Sync native ACLs
                try:
                    sync_native_cloud_acls(
                        company_id=company_id,
                        provider=provider,
                        document_id=doc_record_id,
                        acl_emails=item.acl_emails or [],
                        acl_external_ids=item.acl_external_ids or [],
                        owner_email=item.owner_email or account_identifier,
                        is_restricted_inheritance=item.is_restricted_inheritance,
                    )
                except Exception:
                    recompute_document_acl(doc_record_id, company_id=company_id)

                now_iso = datetime.now(timezone.utc).isoformat()
                item_meta = dict(item.metadata or {})
                item_meta["acl_emails"] = sorted(set(item.acl_emails or []))
                item_meta["acl_external_ids"] = sorted(set(item.acl_external_ids or []))

                supabase_admin.table("integration_synced_items").upsert(
                    {
                        "integration_id": target_int_id,
                        "company_id": company_id,
                        "source_id": source_container,
                        "external_item_id": item.item_id,
                        "item_name": clean_filename,
                        "item_type": ext,
                        "item_path": item.relative_path or clean_filename,
                        "parent_external_id": item.parent_container_id,
                        "size_bytes": file_size,
                        "content_hash": item.content_hash,
                        "coach_document_id": doc_record_id,
                        "status": "completed",
                        "metadata": item_meta,
                        "synced_at": now_iso,
                    },
                    on_conflict="integration_id,external_item_id,content_hash",
                ).execute()

                if is_update:
                    updated_count += 1
                else:
                    synced_count += 1

            except Exception as item_err:
                errors.append({"item_id": getattr(item, "item_id", None), "error": str(item_err)})

        # Advance sync_cursor after successful delta pass
        now_iso = datetime.now(timezone.utc).isoformat()
        if new_cursor:
            for src in sources:
                supabase_admin.table("integration_monitored_sources").update({
                    "sync_cursor": new_cursor,
                    "last_synced_at": now_iso,
                    "updated_at": now_iso,
                }).eq("integration_id", target_int_id).eq("source_id", src["source_id"]).execute()

            cfg = dict(integration.get("config") or {})
            cfg["last_page_token"] = new_cursor
            supabase_admin.table("company_integrations").update({
                "config": cfg,
                "last_synced_at": now_iso,
                "updated_at": now_iso,
            }).eq("id", target_int_id).execute()

        if synced_count or updated_count or deleted_count or acl_updated_count:
            invalidate_company_security_cache(company_id)

        return {
            "status": "success" if not errors else "partial",
            "integration_id": target_int_id,
            "synced_count": synced_count,
            "updated_count": updated_count,
            "deleted_count": deleted_count,
            "acl_updated_count": acl_updated_count,
            "errors": errors,
            "duration_seconds": round(time.time() - start_time, 2),
        }

    finally:
        try:
            redis_client.delete(lock_key)
        except Exception:
            pass


async def reconcile_all_integrations_cdc() -> Dict[str, Any]:
    """
    Periodic CDC reconciliation job across all active integrations.
    Catches permission drift, missed webhooks, or cloud connectors without push events.
    """
    res = (
        supabase_admin.table("company_integrations")
        .select("id, company_id, provider, last_synced_at")
        .eq("status", "active")
        .execute()
    )
    integrations = getattr(res, "data", None) or []
    processed = 0
    failed = 0

    for integ in integrations:
        try:
            await run_incremental_cdc_sync(
                company_id=str(integ["company_id"]),
                provider=str(integ["provider"]),
                integration_id=str(integ["id"]),
            )
            processed += 1
        except Exception as e:
            print(f"[CDC RECONCILE] Error syncing integration {integ.get('id')}: {e}")
            failed += 1

    return {"processed": processed, "failed": failed}


async def sweep_expired_role_assignments() -> int:
    """Deactivates expired temporary role assignments & expired ReBAC share tuples."""
    now_iso = datetime.now(timezone.utc).isoformat()
    revoked_count = 0

    try:
        res = (
            supabase_admin.table("user_role_assignments")
            .select("user_role_assignment_id, user_id, expires_at")
            .eq("is_active", True)
            .lt("expires_at", now_iso)
            .execute()
        )
        expired_roles = getattr(res, "data", None) or []
        for row in expired_roles:
            supabase_admin.table("user_role_assignments").update({
                "is_active": False
            }).eq("user_role_assignment_id", row["user_role_assignment_id"]).execute()
            invalidate_user_security_cache(None, str(row["user_id"]))
            revoked_count += 1
    except Exception as e:
        print(f"[CDC EXPIRY] Role assignment sweep warning: {e}")

    try:
        tup_res = (
            supabase_admin.table("rebac_tuples")
            .select("id, company_id, object_type, object_id")
            .lt("expires_at", now_iso)
            .execute()
        )
        expired_tuples = getattr(tup_res, "data", None) or []
        affected_companies = set()
        for t in expired_tuples:
            supabase_admin.table("rebac_tuples").delete().eq("id", t["id"]).execute()
            if t.get("object_type") == "document" and t.get("object_id"):
                recompute_document_acl(str(t["object_id"]), company_id=str(t["company_id"]))
            if t.get("company_id"):
                affected_companies.add(str(t["company_id"]))
            revoked_count += 1
        for cid in affected_companies:
            invalidate_company_security_cache(cid)
    except Exception as e:
        print(f"[CDC EXPIRY] ReBAC tuple sweep warning: {e}")

    return revoked_count


def handle_org_membership_change(
    company_id: str,
    user_id: Optional[str] = None,
    affected_manager_ids: Optional[List[str]] = None,
) -> None:
    """
    Event hook invoked synchronously after role updates, manager reassignments,
    department/team transfers, or employee offboarding.
    """
    if company_id:
        # Invalidate company-wide principal cache so manager subtrees and team memberships recompute cleanly
        invalidate_company_security_cache(str(company_id))
    elif user_id:
        invalidate_user_security_cache(None, str(user_id))

    for mid in (affected_manager_ids or []):
        if mid:
            invalidate_user_security_cache(company_id, str(mid))

