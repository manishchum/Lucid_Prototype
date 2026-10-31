# Backend/services/connectors/manager.py
"""
Central Integration Orchestrator and Synchronization Manager.
Coordinates:
- Token retrieval, renewal, and encryption in Supabase Vault
- Monitored source selection (My Drive and Shared Drives with deep recursion)
- Real-time Webhook subscriptions and renewals
- File ingestion, re-ingestion on modification, chunk purging, and deletion handling
- Concurrency control and Redis debouncing
"""

import os
import uuid
import hashlib
import time
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List, Tuple

from utils.supabase_client import supabase_admin
from ingestion.coach_store import create_document_record
from ingestion.coach_pipeline import run_coach_file_ingestion
from services.connectors.registry import ConnectorRegistry
from services.connectors.models import (
    ConnectorStatus,
    ContainerItem,
    SyncItemInfo,
    SyncBatchResult
)

BUCKET_NAME = "coach-documents"
TEMP_DIR = os.path.join(os.getcwd(), "storage", "temp_coach_uploads")


class ConnectorManager:
    @staticmethod
    def get_webhook_url_for_provider(provider: str) -> str:
        env_key = f"{provider.upper()}_WEBHOOK_URL"
        custom_url = os.getenv(env_key, "").strip()
        if custom_url:
            return custom_url
        if provider == "google_drive":
            gd_url = os.getenv("GOOGLE_DRIVE_WEBHOOK_URL", "").strip()
            if gd_url:
                return gd_url
        api_base = os.getenv("API_BASE_URL", "").rstrip("/")
        if not api_base:
            api_base = os.getenv("FRONTEND_URL", "https://api.lucid.work").rstrip("/")
        return f"{api_base}/api/connectors/{provider}/webhook"
    """Enterprise Manager orchestrating cloud integrations."""

    @staticmethod
    async def get_valid_access_token(company_id: str, provider: str) -> str:
        """
        Retrieves a valid access token securely from Supabase Vault via RPC.
        Automatically handles token expiration and rotation using the stored refresh token.
        """
        current_time = datetime.now(timezone.utc)

        # 1. Fetch decrypted credentials from Supabase Vault
        token_rpc = supabase_admin.rpc("get_integration_tokens", {
            "p_company_id": str(company_id),
            "p_provider": provider
        }).execute()
        vault_data = getattr(token_rpc, "data", None) or {}

        access_token = vault_data.get("access_token")
        refresh_token = vault_data.get("refresh_token")
        token_expires_at = vault_data.get("token_expires_at")

        # Check validity (with 3-minute grace period)
        is_valid = False
        if access_token and token_expires_at:
            try:
                exp_dt = datetime.fromisoformat(str(token_expires_at).replace("Z", "+00:00"))
                if exp_dt > current_time + timedelta(minutes=3):
                    is_valid = True
            except Exception:
                is_valid = False

        if is_valid and access_token:
            return access_token

        # 2. Token expired or missing; perform refresh via connector
        if not refresh_token:
            raise ValueError(f"No refresh token found in Vault for company {company_id} (provider: {provider})")

        connector = ConnectorRegistry.get(provider)
        refreshed = await connector.refresh_access_token(refresh_token)

        new_access_token = refreshed["access_token"]
        new_refresh_token = refreshed.get("refresh_token") or refresh_token
        expires_in = refreshed.get("expires_in", 3600)
        new_expires_at = (current_time + timedelta(seconds=expires_in)).isoformat()

        # 3. Store updated tokens in Vault
        supabase_admin.rpc("store_integration_tokens", {
            "p_company_id": str(company_id),
            "p_provider": provider,
            "p_access_token": new_access_token,
            "p_refresh_token": new_refresh_token,
            "p_token_expires_at": new_expires_at
        }).execute()

        # Update company_integrations token_expires_at
        supabase_admin.table("company_integrations").update({
            "token_expires_at": new_expires_at,
            "updated_at": current_time.isoformat()
        }).eq("company_id", company_id).eq("provider", provider).execute()

        return new_access_token

    @staticmethod
    async def get_connector_status(company_id: str, provider: str = "google_drive") -> ConnectorStatus:
        """Fetches unified status, monitored container info, and sync metrics."""
        # 1. Fetch integration row
        res = (
            supabase_admin.table("company_integrations")
            .select("*")
            .eq("company_id", company_id)
            .eq("provider", provider)
            .limit(1)
            .execute()
        )
        integration = res.data[0] if (res and getattr(res, "data", None)) else None

        if not integration or integration.get("status") == "disconnected":
            return ConnectorStatus(
                connected=False,
                provider=provider,
                company_id=company_id,
                status="disconnected"
            )

        config = integration.get("config") or {}

        # 2. Fetch primary monitored source
        source_res = (
            supabase_admin.table("integration_monitored_sources")
            .select("*")
            .eq("integration_id", integration["id"])
            .limit(1)
            .execute()
        )
        source = source_res.data[0] if (source_res and getattr(source_res, "data", None)) else None

        # 3. Fetch count of completed items
        items_res = (
            supabase_admin.table("integration_synced_items")
            .select("id", count="exact")
            .eq("integration_id", integration["id"])
            .eq("status", "completed")
            .execute()
        )
        synced_count = items_res.count if (items_res and getattr(items_res, "count", None) is not None) else 0

        webhook_active = bool(config.get("webhook_channel_id"))

        return ConnectorStatus(
            connected=True,
            provider=provider,
            company_id=company_id,
            account_identifier=integration.get("account_identifier"),
            status=integration.get("status", "active"),
            monitored_source_id=source.get("source_id") if source else config.get("folder_id"),
            monitored_source_name=source.get("source_name") if source else config.get("folder_name"),
            monitored_source_path=source.get("source_path") if source else "/",
            monitored_source_type=source.get("source_type") if source else "folder",
            is_recursive=source.get("is_recursive", True) if source else True,
            webhook_active=webhook_active,
            webhook_expiration=config.get("webhook_expiration"),
            last_synced_at=integration.get("last_synced_at"),
            total_synced_files=synced_count,
            error_message=integration.get("error_message"),
            connected_at=integration.get("created_at"),
            config=config
        )

    @staticmethod
    async def select_monitored_container(
        company_id: str,
        container_id: str,
        container_name: str,
        container_path: str = "/",
        container_type: str = "folder",
        is_recursive: bool = True,
        drive_id: Optional[str] = None,
        provider: str = "google_drive"
    ) -> Dict[str, Any]:
        """
        Sets or switches the monitored container for a company.
        Registers real-time push watch channel on the new selection.
        """
        # Fetch integration
        res = (
            supabase_admin.table("company_integrations")
            .select("*")
            .eq("company_id", company_id)
            .eq("provider", provider)
            .limit(1)
            .execute()
        )
        integration = res.data[0] if (res and getattr(res, "data", None)) else None
        if not integration:
            raise ValueError(f"No {provider} integration found for organization.")

        integration_id = integration["id"]
        config = dict(integration.get("config") or {})
        connector = ConnectorRegistry.get(provider)

        # Get access token
        access_token = await ConnectorManager.get_valid_access_token(company_id, provider)

        # Check if monitored folder is changing to preserve previous files
        old_folder_id = config.get("folder_id")
        old_folder_name = config.get("folder_name")
        if old_folder_id and old_folder_id != container_id:
            print(f"[{provider.upper()}] Monitored folder changed from '{old_folder_name}' ({old_folder_id}) to '{container_name}' ({container_id})")
            now_iso = datetime.now(timezone.utc).isoformat()
            try:
                # Retain old items in knowledge base, mark connector record as detached
                supabase_admin.table("integration_synced_items").update({
                    "status": "detached"
                }).eq("integration_id", integration_id).neq("source_id", container_id).execute()
                print(f"[{provider.upper()}] Preserved existing synced records from previous folder '{old_folder_name}' as 'detached'")
            except Exception as detach_err:
                print(f"[{provider.upper()}] Note: Could not mark previous items as detached: {detach_err}")

        # Stop existing webhook if registered
        old_channel = config.get("webhook_channel_id")
        old_resource = config.get("webhook_resource_id")
        if old_channel and old_resource:
            try:
                await connector.stop_watch(access_token, old_channel, old_resource)
            except Exception as e:
                print(f"[{provider.upper()}] Note: Could not stop old watch: {e}")

        # Register new webhook watch
        webhook_url = ConnectorManager.get_webhook_url_for_provider(provider)
        watch_info = await connector.register_watch(access_token, container_id, webhook_url)

        # Update config
        config.update({
            "folder_id": container_id,
            "folder_name": container_name,
            "drive_id": drive_id,
            "webhook_channel_id": watch_info.get("channel_id"),
            "webhook_resource_id": watch_info.get("resource_id"),
            "webhook_expiration": watch_info.get("expiration"),
            "last_page_token": watch_info.get("start_cursor")
        })

        # Update company_integrations
        supabase_admin.table("company_integrations").update({
            "config": config,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", integration_id).execute()

        # Update or insert monitored source
        source_row = {
            "integration_id": integration_id,
            "company_id": company_id,
            "source_id": container_id,
            "source_type": container_type,
            "source_name": container_name,
            "source_path": container_path,
            "is_recursive": is_recursive,
            "sync_cursor": watch_info.get("start_cursor"),
            "metadata": {"drive_id": drive_id},
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        supabase_admin.table("integration_monitored_sources").upsert(
            source_row,
            on_conflict="integration_id,source_id"
        ).execute()

        # Also keep backwards compatibility with legacy google_drive_integrations table if present
        try:
            supabase_admin.table("google_drive_integrations").update({
                "folder_id": container_id,
                "folder_name": container_name,
                "webhook_channel_id": watch_info.get("channel_id"),
                "webhook_resource_id": watch_info.get("resource_id"),
                "webhook_expiration": watch_info.get("expiration"),
                "last_page_token": watch_info.get("start_cursor"),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }).eq("company_id", company_id).execute()
        except Exception:
            pass

        print(f"[{provider.upper()}] Monitored container updated to '{container_name}' (ID: {container_id}) for company {company_id}")

        return {
            "success": True,
            "container_id": container_id,
            "container_name": container_name,
            "webhook_active": bool(watch_info.get("channel_id"))
        }

    @staticmethod
    async def sync_company_files(
        company_id: str,
        provider: str = "google_drive"
    ) -> SyncBatchResult:
        """
        Main Ingestion Routine:
        1. Reads monitored containers and subtrees.
        2. Downloads files, handles native workspace conversions.
        3. Checks deduplication (skips unmodified).
        4. Detects updates: deletes old vector chunks, re-embeds document.
        5. Detects deletions: removes vector chunks, updates status.
        6. Updates integration_synced_items and coach_uploaded_documents.
        """
        start_time = time.time()

        # 1. Fetch integration
        res = (
            supabase_admin.table("company_integrations")
            .select("*")
            .eq("company_id", company_id)
            .eq("provider", provider)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        integration = res.data[0] if (res and getattr(res, "data", None)) else None
        if not integration:
            return SyncBatchResult(
                provider=provider,
                company_id=company_id,
                status="skipped",
                message="No active integration found for company."
            )

        integration_id = integration["id"]
        connected_user_id = integration.get("connected_by")
        account_identifier = integration.get("account_identifier")
        config = integration.get("config") or {}

        # 2. Fetch monitored sources
        sources_res = (
            supabase_admin.table("integration_monitored_sources")
            .select("*")
            .eq("integration_id", integration_id)
            .execute()
        )
        sources = sources_res.data if (sources_res and getattr(sources_res, "data", None)) else []

        if not sources:
            # Fallback to config folder_id if not in monitored sources table
            folder_id = config.get("folder_id")
            if folder_id:
                sources = [{
                    "source_id": folder_id,
                    "source_name": config.get("folder_name", "Ingestion Folder"),
                    "source_path": "/",
                    "is_recursive": True,
                    "metadata": {"drive_id": config.get("drive_id")}
                }]
            else:
                return SyncBatchResult(
                    provider=provider,
                    company_id=company_id,
                    status="skipped",
                    message="No monitored sources configured for integration."
                )

        connector = ConnectorRegistry.get(provider)
        access_token = await ConnectorManager.get_valid_access_token(company_id, provider)

        synced_count = 0
        updated_count = 0
        deleted_count = 0
        skipped_count = 0
        errors: List[Dict[str, Any]] = []

        # 3. Process each monitored container
        for src in sources:
            container_id = src["source_id"]
            is_recursive = src.get("is_recursive", True)
            drive_id = (src.get("metadata") or {}).get("drive_id")

            try:
                items = await connector.fetch_items_in_container(
                    access_token=access_token,
                    container_id=container_id,
                    is_recursive=is_recursive,
                    drive_id=drive_id
                )
            except Exception as scan_err:
                err_msg = f"Failed to scan container {container_id}: {str(scan_err)}"
                print(f"[{provider.upper()} ERROR] {err_msg}")
                errors.append({"container_id": container_id, "error": err_msg})
                continue

            print(f"[{provider.upper()} SYNC] Found {len(items)} eligible file(s) in container '{src.get('source_name')}'")

            # 1. Batch fetch existing synced records to eliminate N individual roundtrips
            item_ids = [it.item_id for it in items]
            existing_map: Dict[str, Dict[str, Any]] = {}
            if item_ids:
                for chunk_idx in range(0, len(item_ids), 150):
                    chunk = item_ids[chunk_idx:chunk_idx + 150]
                    try:
                        ex_res = (
                            supabase_admin.table("integration_synced_items")
                            .select("id, status, content_hash, coach_document_id, external_item_id")
                            .eq("integration_id", integration_id)
                            .in_("external_item_id", chunk)
                            .execute()
                        )
                        if ex_res and ex_res.data:
                            for row in ex_res.data:
                                existing_map[row["external_item_id"]] = row
                    except Exception as ex_err:
                        print(f"[{provider.upper()} SYNC] Batch query note: {ex_err}")

            # 2. Filter out already-indexed unchanged files in memory (O(1) lookup, 0 network latency)
            items_to_process: List[Tuple[Any, Optional[Dict[str, Any]], bool]] = []
            for item in items:
                existing = existing_map.get(item.item_id)
                if existing and existing.get("status") == "completed" and existing.get("content_hash") == item.content_hash:
                    skipped_count += 1
                    continue
                is_update = existing is not None and existing.get("content_hash") != item.content_hash
                items_to_process.append((item, existing, is_update))

            if not items_to_process:
                print(f"[{provider.upper()} SYNC] All {len(items)} file(s) in '{src.get('source_name')}' are up-to-date. Nothing to ingest.")
                continue

            print(f"[{provider.upper()} SYNC] Ingesting {len(items_to_process)} new/modified file(s) with concurrency=3...")

            # 3. Process new and updated files concurrently with bounded semaphore
            sem = asyncio.Semaphore(3)
            lock = asyncio.Lock()

            async def _process_single_item(item, existing, is_update):
                nonlocal synced_count, updated_count, skipped_count
                async with sem:
                    try:
                        # Download / export file content
                        content, clean_filename, ext = await connector.download_item(access_token, item)
                        file_size = len(content)
                        if file_size == 0:
                            async with lock:
                                skipped_count += 1
                            return

                        file_sha = hashlib.sha256(content).hexdigest()

                        # Handle re-ingestion: purge old chunks if file was previously indexed
                        existing_doc_id = existing.get("coach_document_id") if existing else None
                        if is_update and existing_doc_id:
                            print(f"[{provider.upper()} SYNC] File '{clean_filename}' was updated. Purging old vector chunks...")
                            try:
                                supabase_admin.table("coach_document_chunks").delete().eq("document_id", existing_doc_id).execute()
                                doc_id = existing_doc_id
                            except Exception as purge_err:
                                print(f"[{provider.upper()} SYNC] Chunk purge note: {purge_err}")
                                doc_id = str(uuid.uuid4())
                        else:
                            doc_id = str(uuid.uuid4())

                        safe_filename = f"{doc_id}_{clean_filename}"
                        storage_path = f"{company_id}/{doc_id}/{clean_filename}"

                        # Upload to Supabase Storage
                        try:
                            supabase_admin.storage.from_(BUCKET_NAME).upload(
                                path=storage_path,
                                file=content,
                                file_options={"content-type": "application/octet-stream", "upsert": "true"}
                            )
                        except Exception as st_err:
                            print(f"[{provider.upper()} SYNC] Storage upload note: {st_err}")
                            storage_path = f"local_storage/{safe_filename}"

                        # Upsert or create master document record
                        if is_update and existing_doc_id:
                            supabase_admin.table("coach_uploaded_documents").update({
                                "file_name": clean_filename,
                                "file_size_bytes": file_size,
                                "file_hash": file_sha,
                                "storage_path": storage_path,
                                "indexing_status": "pending",
                                "updated_at": datetime.now(timezone.utc).isoformat()
                            }).eq("id", existing_doc_id).execute()
                            doc_record_id = existing_doc_id
                        else:
                            # Disambiguate and link target employee if detected from meeting participants or metadata
                            resolved_emp_id = (item.metadata or {}).get("target_employee_id")
                            if not resolved_emp_id and (item.metadata or {}).get("detected_participants"):
                                try:
                                    from services.connectors.providers.google_meet.client import match_speaker_to_employee
                                    from ingestion.coach_store import fetch_company_employees
                                    roster = fetch_company_employees(company_id)
                                    resolved_emp_id = match_speaker_to_employee(
                                        item.metadata["detected_participants"],
                                        roster,
                                        host_email=account_identifier
                                    )
                                    if resolved_emp_id:
                                        print(f"[{provider.upper()} SYNC] Resolved speaker to employee_id={resolved_emp_id}")
                                except Exception as match_err:
                                    print(f"[{provider.upper()} SYNC] Employee match note: {match_err}")

                            doc_record = create_document_record(
                                company_id=company_id,
                                uploaded_by=connected_user_id,
                                file_name=clean_filename,
                                file_type=ext,
                                file_size_bytes=file_size,
                                storage_path=storage_path,
                                file_hash=file_sha,
                                target_employee_id=resolved_emp_id,
                                manual_description=f"Auto-imported from {connector.display_name}: {src.get('source_name', 'Folder')}"
                            )
                            doc_record_id = doc_record["id"]

                        # Save to local temp file for coach_pipeline embedding
                        os.makedirs(TEMP_DIR, exist_ok=True)
                        temp_file_path = os.path.join(TEMP_DIR, safe_filename)
                        with open(temp_file_path, "wb") as f:
                            f.write(content)

                        try:
                            # Run heavy text extraction & embedding in worker thread so event loop stays unblocked
                            await asyncio.to_thread(
                                run_coach_file_ingestion,
                                file_path=temp_file_path,
                                document_id=doc_record_id,
                                company_id=company_id,
                                file_name=clean_filename,
                                file_type=ext,
                                target_employee_id=resolved_emp_id if not is_update else None
                            )
                        finally:
                            if os.path.exists(temp_file_path):
                                try:
                                    os.remove(temp_file_path)
                                except Exception:
                                    pass

                        # Record in integration_synced_items
                        now_iso = datetime.now(timezone.utc).isoformat()
                        synced_row = {
                            "integration_id": integration_id,
                            "company_id": company_id,
                            "source_id": container_id,
                            "external_item_id": item.item_id,
                            "item_name": clean_filename,
                            "item_type": ext,
                            "item_path": item.relative_path or clean_filename,
                            "parent_external_id": item.parent_container_id,
                            "size_bytes": file_size,
                            "content_hash": item.content_hash,
                            "external_modified_time": item.modified_time.isoformat() if item.modified_time else None,
                            "coach_document_id": doc_record_id,
                            "status": "completed",
                            "metadata": item.metadata,
                            "synced_at": now_iso
                        }
                        supabase_admin.table("integration_synced_items").upsert(
                            synced_row,
                            on_conflict="integration_id,external_item_id,content_hash"
                        ).execute()

                        # Also update legacy table for backwards compatibility
                        if provider == "google_drive":
                            try:
                                supabase_admin.table("google_drive_synced_files").upsert({
                                    "company_id": company_id,
                                    "integration_id": integration_id,
                                    "drive_file_id": item.item_id,
                                    "file_name": clean_filename,
                                    "file_type": ext,
                                    "file_size_bytes": file_size,
                                    "md5_checksum": item.content_hash,
                                    "drive_modified_time": item.modified_time.isoformat() if item.modified_time else None,
                                    "coach_document_id": doc_record_id,
                                    "status": "completed",
                                    "synced_at": now_iso
                                }, on_conflict="company_id,drive_file_id,md5_checksum").execute()
                            except Exception:
                                pass

                        async with lock:
                            if is_update:
                                updated_count += 1
                                print(f"[{provider.upper()} SYNC] Successfully updated: {clean_filename}")
                            else:
                                synced_count += 1
                                print(f"[{provider.upper()} SYNC] Successfully ingested: {clean_filename}")

                    except Exception as file_err:
                        err_text = str(file_err)
                        print(f"[{provider.upper()} SYNC ERROR] Failed to ingest {item.item_name}: {err_text}")
                        async with lock:
                            errors.append({"file": item.item_name, "error": err_text})

                        # Record error state in integration_synced_items
                        try:
                            supabase_admin.table("integration_synced_items").upsert({
                                "integration_id": integration_id,
                                "company_id": company_id,
                                "source_id": container_id,
                                "external_item_id": item.item_id,
                                "item_name": item.item_name,
                                "item_type": item.item_type,
                                "content_hash": item.content_hash,
                                "status": "failed",
                                "error_message": err_text,
                                "synced_at": datetime.now(timezone.utc).isoformat()
                            }, on_conflict="integration_id,external_item_id,content_hash").execute()
                        except Exception:
                            pass

            await asyncio.gather(*[_process_single_item(it, ex, upd) for it, ex, upd in items_to_process])

        # Update integration stats
        now_iso = datetime.now(timezone.utc).isoformat()
        err_summary = None if not errors else f"{len(errors)} file(s) failed during sync"
        supabase_admin.table("company_integrations").update({
            "last_synced_at": now_iso,
            "error_message": err_summary,
            "updated_at": now_iso
        }).eq("id", integration_id).execute()

        # Update legacy table if Google Drive
        if provider == "google_drive":
            try:
                supabase_admin.table("google_drive_integrations").update({
                    "last_synced_at": now_iso,
                    "error_message": err_summary
                }).eq("company_id", company_id).execute()
            except Exception:
                pass

        elapsed = time.time() - start_time
        return SyncBatchResult(
            provider=provider,
            company_id=company_id,
            status="success" if not errors else ("partial" if synced_count > 0 else "error"),
            synced_count=synced_count,
            updated_count=updated_count,
            deleted_count=deleted_count,
            skipped_count=skipped_count,
            errors=errors,
            message=f"Ingested {synced_count} new file(s), updated {updated_count}, skipped {skipped_count}.",
            duration_seconds=round(elapsed, 2)
        )

    @staticmethod
    async def renew_expiring_webhooks(provider: str = "google_drive") -> int:
        """Periodic routine to renew push channels expiring within 48 hours."""
        cutoff = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
        try:
            res = (
                supabase_admin.table("company_integrations")
                .select("*")
                .eq("provider", provider)
                .eq("status", "active")
                .execute()
            )
        except Exception as e:
            print(f"[RENEWAL ERROR] Failed to query integrations: {e}")
            return 0

        integrations = res.data if (res and getattr(res, "data", None)) else []
        renewed_count = 0
        connector = ConnectorRegistry.get(provider)
        webhook_url = ConnectorManager.get_webhook_url_for_provider(provider)

        for item in integrations:
            config = dict(item.get("config") or {})
            exp = config.get("webhook_expiration")
            if not exp or exp > cutoff:
                continue

            folder_id = config.get("folder_id")
            if not folder_id:
                continue

            try:
                access_token = await ConnectorManager.get_valid_access_token(item["company_id"], provider)
                watch_info = await connector.register_watch(access_token, folder_id, webhook_url)
                if watch_info.get("channel_id"):
                    config.update({
                        "webhook_channel_id": watch_info["channel_id"],
                        "webhook_resource_id": watch_info["resource_id"],
                        "webhook_expiration": watch_info["expiration"]
                    })
                    supabase_admin.table("company_integrations").update({
                        "config": config,
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }).eq("id", item["id"]).execute()
                    renewed_count += 1
            except Exception as e:
                print(f"[RENEWAL ERROR] Failed to renew webhook for company {item.get('company_id')}: {e}")

        return renewed_count

    @staticmethod
    async def disconnect_integration(company_id: str, provider: str = "google_drive") -> bool:
        """Disconnects integration, terminates watch channels, and clears Vault secrets."""
        res = (
            supabase_admin.table("company_integrations")
            .select("*")
            .eq("company_id", company_id)
            .eq("provider", provider)
            .limit(1)
            .execute()
        )
        integration = res.data[0] if (res and getattr(res, "data", None)) else None
        if not integration:
            return True

        config = integration.get("config") or {}
        channel_id = config.get("webhook_channel_id")
        resource_id = config.get("webhook_resource_id")

        try:
            token_rpc = supabase_admin.rpc("get_integration_tokens", {
                "p_company_id": str(company_id),
                "p_provider": provider
            }).execute()
            access_token = (getattr(token_rpc, "data", None) or {}).get("access_token")
            if access_token and channel_id and resource_id:
                connector = ConnectorRegistry.get(provider)
                await connector.stop_watch(access_token, channel_id, resource_id)
        except Exception as e:
            print(f"[{provider.upper()} DISCONNECT] Note stopping watch: {e}")

        # Delete secrets from Supabase Vault
        supabase_admin.rpc("delete_integration_tokens", {
            "p_company_id": str(company_id),
            "p_provider": provider
        }).execute()

        now_iso = datetime.now(timezone.utc).isoformat()

        # Update company_integrations
        supabase_admin.table("company_integrations").update({
            "status": "disconnected",
            "config": {},
            "updated_at": now_iso
        }).eq("id", integration["id"]).execute()

        # Update legacy table if Google Drive
        if provider == "google_drive":
            try:
                supabase_admin.table("google_drive_integrations").update({
                    "sync_status": "disconnected",
                    "webhook_channel_id": None,
                    "webhook_resource_id": None,
                    "webhook_expiration": None,
                    "updated_at": now_iso
                }).eq("company_id", company_id).execute()
            except Exception:
                pass

        return True



