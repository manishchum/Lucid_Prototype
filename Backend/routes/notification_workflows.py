import json
import hashlib
import logging
import asyncio
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, model_validator
from datetime import datetime, timezone
from utils.auth import RequestAuth, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client
from utils.notifications.workflow_engine import WorkflowEngine
from utils.notifications.context_enricher import NotificationContextEnricher
from utils.notifications.template_engine import TemplateCompiler

logger = logging.getLogger("lucid.notification_workflows")

router = APIRouter(prefix="/api/notifications/workflows", tags=["Notification Workflows"])


def compute_workflow_fingerprint(
    trigger_lifecycle: str,
    filter_rules: List[Dict[str, Any]],
    filter_match_type: str,
    notification_type: str,
    channels: List[str],
    delivery_policy: str = "PARALLEL",
    title_template: Optional[str] = None,
    body_template: Optional[str] = None,
) -> str:
    """
    Computes a deterministic SHA-256 fingerprint representing the core operational
    definition of the workflow for conflict and duplicate checking.
    """
    canonical_rules = sorted(
        filter_rules,
        key=lambda r: (str(r.get("field") or ""), str(r.get("operator") or "")),
    )
    canonical_channels = sorted([c.upper() for c in channels])
    raw = (
        f"{trigger_lifecycle.strip().upper()}|"
        f"{json.dumps(canonical_rules, sort_keys=True)}|"
        f"{filter_match_type.strip().upper()}|"
        f"{notification_type.strip().upper()}|"
        f"{','.join(canonical_channels)}|"
        f"{delivery_policy.strip().upper()}|"
        f"{(title_template or '').strip()}|"
        f"{(body_template or '').strip()}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class FilterRuleModel(BaseModel):
    field: str
    operator: str = "=="
    value: Any = None


class WorkflowCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=255)
    description: Optional[str] = None
    trigger_lifecycle: str = Field(..., description="Lifecycle event hook key")
    category: str = "CUSTOM"
    filter_rules: List[FilterRuleModel] = []
    filter_match_type: str = "ALL"
    notification_type: str = Field(..., description="Unique event notification key")
    channels: List[str] = ["IN_APP", "PUSH"]
    delivery_policy: str = "PARALLEL"
    rule_mode: str = "THRESHOLD"
    recipient_routing: str = "LEARNER"  # "LEARNER", "MANAGER", "BOTH"
    audience_filter: Optional[Dict[str, Any]] = None
    schedule_type: str = "EVENT_DRIVEN"  # "EVENT_DRIVEN" or "RECURRING"
    schedule_config: Optional[Dict[str, Any]] = None  # {"frequency": "DAILY", "time": "09:00", "days": ["MON"]}
    template_id: Optional[str] = None
    pinned_template_id: Optional[str] = None
    pinned_template_version_id: Optional[str] = None
    secondary_template_id: Optional[str] = None
    title_template: Optional[str] = None
    body_template: Optional[str] = None
    secondary_title_template: Optional[str] = None
    secondary_body_template: Optional[str] = None
    cooldown_seconds: int = 3600
    priority: str = "NORMAL"
    is_active: bool = True

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


class WorkflowUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    trigger_lifecycle: Optional[str] = None
    category: Optional[str] = None
    filter_rules: Optional[List[FilterRuleModel]] = None
    filter_match_type: Optional[str] = None
    notification_type: Optional[str] = None
    channels: Optional[List[str]] = None
    delivery_policy: Optional[str] = None
    rule_mode: Optional[str] = None
    recipient_routing: Optional[str] = None
    audience_filter: Optional[Dict[str, Any]] = None
    schedule_type: Optional[str] = None
    schedule_config: Optional[Dict[str, Any]] = None
    template_id: Optional[str] = None
    pinned_template_id: Optional[str] = None
    pinned_template_version_id: Optional[str] = None
    secondary_template_id: Optional[str] = None
    title_template: Optional[str] = None
    body_template: Optional[str] = None
    secondary_title_template: Optional[str] = None
    secondary_body_template: Optional[str] = None
    cooldown_seconds: Optional[int] = None
    priority: Optional[str] = None
    is_active: Optional[bool] = None

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


class WorkflowRollbackRequest(BaseModel):
    target_version: int

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


class WorkflowSimulateRequest(BaseModel):
    trigger_lifecycle: str
    user_id: Optional[str] = None
    sample_payload: Dict[str, Any] = {}
    filter_rules: List[FilterRuleModel] = []
    filter_match_type: str = "ALL"
    rule_mode: str = "THRESHOLD"
    recipient_routing: Optional[str] = "LEARNER"
    audience_filter: Optional[Dict[str, Any]] = None
    title_template: str
    body_template: str
    secondary_title_template: Optional[str] = None
    secondary_body_template: Optional[str] = None
    delivery_policy: Optional[str] = "PARALLEL"

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                pass
        if isinstance(data, dict):
            if "simulated_payload" in data and "sample_payload" not in data:
                data["sample_payload"] = data["simulated_payload"]
        return data


async def require_developer_role(user_id: str) -> None:
    """Verifies that the requesting user strictly has the developer role."""
    from utils.db.permissions import check_user_permission
    try:
        # Strictly check for developer role (level 6)
        if await check_user_permission(user_id, "developer"):
            return
    except Exception:
        pass

    try:
        service_client = get_service_supabase_client()
        role_res = service_client.table("user_role_assignments").select("roles(name, level)").eq("user_id", user_id).execute()
        for r in (role_res.data or []):
            role_data = r.get("roles") or {}
            role_name = (role_data.get("name") or "").lower()
            role_lvl = role_data.get("level") or 0
            if role_name == "developer" or role_lvl >= 6:
                return
    except Exception:
        pass

    raise HTTPException(
        status_code=403,
        detail="Forbidden: Developer role required to manage automated notification workflows."
    )


@router.get("")
async def list_workflows(
    category: Optional[str] = None,
    trigger_lifecycle: Optional[str] = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Lists all automated notification workflows (strictly Developer role)."""
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()
        query = db.table("notification_workflows").select("*").order("created_at", desc=True)

        if category:
            query = query.eq("category", category)
        if trigger_lifecycle:
            query = query.eq("trigger_lifecycle", trigger_lifecycle)

        # Tenant isolation: non-developers only see their company or global workflows
        is_dev = False
        try:
            from utils.db.permissions import check_user_permission
            is_dev = await check_user_permission(auth_ctx.user_id, "developer")
        except Exception:
            pass

        if not is_dev and auth_ctx.company_id:
            query = query.or_(f"company_id.eq.{auth_ctx.company_id},company_id.is.null")

        res = query.execute()
        workflows = getattr(res, "data", []) or []
        for wf in workflows:
            aud = wf.get("audience_filter") or {}
            sch = aud.get("schedule") or {}
            wf["schedule_type"] = sch.get("type", "EVENT_DRIVEN")
            wf["schedule_config"] = sch.get("config", {})
        return {
            "success": True,
            "count": len(workflows),
            "workflows": workflows,
        }
    except Exception as e:
        logger.error(f"Failed to list workflows: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def create_workflow(
    request: WorkflowCreateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Creates a new automated event trigger workflow with conflict detection,
    delivery fallback policies, and initial immutable version publication.
    Enforces Developer Role verification.
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()

        # Clean notification type key
        notif_key = request.notification_type.strip().upper().replace(" ", "_")
        rules_as_dict = [r.dict() for r in request.filter_rules]
        delivery_pol = request.delivery_policy.strip().upper() if request.delivery_policy else "PARALLEL"

        # Resolve pinned template id from pinned_template_id or template_id
        pinned_tpl = request.pinned_template_id or request.template_id

        resolved_title_tpl = (request.title_template or "").strip()
        resolved_body_tpl = (request.body_template or "").strip()

        # If title or body template were not supplied directly, auto-fetch from pinned template
        if (not resolved_title_tpl or not resolved_body_tpl) and pinned_tpl:
            try:
                pt_res = (
                    db.table("notification_templates")
                    .select("title_template, body_template")
                    .eq("id", pinned_tpl)
                    .maybe_single()
                    .execute()
                )
                if pt_res.data:
                    if not resolved_title_tpl:
                        resolved_title_tpl = pt_res.data.get("title_template") or request.title.strip()
                    if not resolved_body_tpl:
                        resolved_body_tpl = pt_res.data.get("body_template") or request.description or "You have a new update."
            except Exception as pte:
                logger.warning(f"Could not auto-fetch pinned template {pinned_tpl}: {pte}")

        # Resilient fallbacks
        if not resolved_title_tpl:
            resolved_title_tpl = request.title.strip()
        if not resolved_body_tpl:
            resolved_body_tpl = request.description or "Please check your portal for complete details."

        fingerprint = compute_workflow_fingerprint(
            trigger_lifecycle=request.trigger_lifecycle,
            filter_rules=rules_as_dict,
            filter_match_type=request.filter_match_type,
            notification_type=notif_key,
            channels=request.channels,
            delivery_policy=delivery_pol,
            title_template=resolved_title_tpl,
            body_template=resolved_body_tpl,
        )

        # Conflict Detection: Warn if another active workflow uses identical trigger with matching filters
        conflict_warning = None
        try:
            existing_active = (
                db.table("notification_workflows")
                .select("id, title, trigger_lifecycle, filter_rules")
                .eq("trigger_lifecycle", request.trigger_lifecycle)
                .eq("is_active", True)
                .execute()
            )
            for ex in (existing_active.data or []):
                if json.dumps(ex.get("filter_rules") or [], sort_keys=True) == json.dumps(rules_as_dict, sort_keys=True):
                    conflict_warning = (
                        f"Potential conflict warning: Workflow '{ex.get('title')}' (ID: {ex.get('id')}) "
                        f"already listens to trigger '{request.trigger_lifecycle}' with identical filter conditions."
                    )
                    break
        except Exception as ce:
            logger.debug(f"Workflow conflict check warning: {ce}")

        insert_payload = {
            "title": request.title.strip(),
            "description": request.description.strip() if request.description else None,
            "trigger_lifecycle": request.trigger_lifecycle.strip(),
            "category": request.category.strip().upper(),
            "filter_rules": rules_as_dict,
            "filter_match_type": request.filter_match_type.strip().upper(),
            "notification_type": notif_key,
            "channels": request.channels or ["IN_APP", "PUSH"],
            "delivery_policy": delivery_pol,
            "rule_mode": request.rule_mode.strip().upper() if request.rule_mode else "THRESHOLD",
            "recipient_routing": (request.recipient_routing or "LEARNER").strip().upper(),
            "audience_filter": {
                **(request.audience_filter or {}),
                "schedule": {
                    "type": request.schedule_type or "EVENT_DRIVEN",
                    "config": request.schedule_config or {},
                },
            },
            "pinned_template_id": pinned_tpl,
            "pinned_template_version_id": request.pinned_template_version_id,
            "secondary_template_id": request.secondary_template_id,
            "title_template": resolved_title_tpl,
            "body_template": resolved_body_tpl,
            "secondary_title_template": request.secondary_title_template.strip() if request.secondary_title_template else None,
            "secondary_body_template": request.secondary_body_template.strip() if request.secondary_body_template else None,
            "cooldown_seconds": request.cooldown_seconds,
            "priority": request.priority.strip().upper(),
            "is_active": request.is_active,
            "created_by": str(auth_ctx.user_id),
            "company_id": auth_ctx.company_id,
            "version_number": 1,
            "content_fingerprint": fingerprint,
        }

        res = db.table("notification_workflows").insert(insert_payload).execute()
        if not res.data:
            raise HTTPException(status_code=400, detail="Failed to create workflow row")

        created_wf = res.data[0]
        created_id = created_wf["id"]

        # Record initial immutable version snapshot (v1)
        if request.is_active:
            try:
                db.table("notification_workflow_versions").insert({
                    "workflow_id": created_id,
                    "version_number": 1,
                    "title": created_wf["title"],
                    "description": created_wf.get("description"),
                    "trigger_lifecycle": created_wf["trigger_lifecycle"],
                    "category": created_wf["category"],
                    "filter_rules": created_wf["filter_rules"],
                    "filter_match_type": created_wf["filter_match_type"],
                    "notification_type": created_wf["notification_type"],
                    "channels": created_wf["channels"],
                    "delivery_policy": delivery_pol,
                    "recipient_routing": created_wf.get("recipient_routing", "LEARNER"),
                    "audience_filter": created_wf.get("audience_filter", {}),
                    "pinned_template_id": created_wf.get("pinned_template_id"),
                    "pinned_template_version_id": created_wf.get("pinned_template_version_id"),
                    "title_template": created_wf["title_template"],
                    "body_template": created_wf["body_template"],
                    "cooldown_seconds": created_wf["cooldown_seconds"],
                    "priority": created_wf["priority"],
                    "content_fingerprint": fingerprint,
                    "published_by": auth_ctx.user_id,
                }).execute()
            except Exception as ve:
                logger.warning(f"Failed to record initial workflow version snapshot: {ve}")

        WorkflowEngine.invalidate_cache(request.trigger_lifecycle)

        return {
            "success": True,
            "workflow": created_wf,
            "message": "Notification workflow created successfully.",
            "conflict_warning": conflict_warning,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create workflow: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Retrieves single workflow by ID (strictly Developer role)."""
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()
        res = (
            db.table("notification_workflows")
            .select("*")
            .eq("id", workflow_id)
            .maybe_single()
            .execute()
        )
        if not res.data:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return {"success": True, "workflow": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    request: WorkflowUpdateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Updates an existing workflow configuration. If active, increments version
    and captures an immutable version snapshot.
    Enforces Developer Role verification.
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()

        # Fetch current record
        current_res = db.table("notification_workflows").select("*").eq("id", workflow_id).maybe_single().execute()
        current = getattr(current_res, "data", None)
        if not current:
            raise HTTPException(status_code=404, detail="Workflow not found")

        update_payload: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        for k, v in request.dict(exclude_unset=True).items():
            if k == "filter_rules" and v is not None:
                update_payload["filter_rules"] = [r.dict() if hasattr(r, "dict") else r for r in v]
            elif v is not None:
                update_payload[k] = v

        if "template_id" in update_payload:
            update_payload["pinned_template_id"] = update_payload.pop("template_id")

        # Pack schedule into audience_filter if updated
        if "schedule_type" in update_payload or "schedule_config" in update_payload or "audience_filter" in update_payload:
            aud = dict(update_payload.get("audience_filter") if "audience_filter" in update_payload else (current.get("audience_filter") or {}))
            sch = dict(aud.get("schedule") or {})
            if "schedule_type" in update_payload:
                sch["type"] = update_payload.pop("schedule_type")
            if "schedule_config" in update_payload:
                sch["config"] = update_payload.pop("schedule_config")
            aud["schedule"] = sch
            update_payload["audience_filter"] = aud

        # Compute new fingerprint
        effective_trigger = update_payload.get("trigger_lifecycle") or current.get("trigger_lifecycle")
        effective_rules = update_payload.get("filter_rules") or current.get("filter_rules") or []
        effective_match_type = update_payload.get("filter_match_type") or current.get("filter_match_type") or "ALL"
        effective_notif_type = update_payload.get("notification_type") or current.get("notification_type") or ""
        effective_channels = update_payload.get("channels") or current.get("channels") or ["IN_APP", "PUSH"]
        effective_delivery_pol = update_payload.get("delivery_policy") or current.get("delivery_policy") or "PARALLEL"
        effective_title = update_payload.get("title_template") or current.get("title_template") or ""
        effective_body = update_payload.get("body_template") or current.get("body_template") or ""

        new_fingerprint = compute_workflow_fingerprint(
            trigger_lifecycle=effective_trigger,
            filter_rules=effective_rules,
            filter_match_type=effective_match_type,
            notification_type=effective_notif_type,
            channels=effective_channels,
            delivery_policy=effective_delivery_pol,
            title_template=effective_title,
            body_template=effective_body,
        )
        update_payload["content_fingerprint"] = new_fingerprint

        current_ver = int(current.get("version_number") or 1)
        effective_active = update_payload.get("is_active") if "is_active" in update_payload else current.get("is_active", True)
        
        # Determine if a new version snapshot should be created
        is_new_version = effective_active and (new_fingerprint != current.get("content_fingerprint") or not current.get("is_active"))
        new_version_num = current_ver + 1 if is_new_version else current_ver

        if is_new_version:
            update_payload["version_number"] = new_version_num

        res = (
            db.table("notification_workflows")
            .update(update_payload)
            .eq("id", workflow_id)
            .execute()
        )
        updated_wf = res.data[0] if res.data else None

        # Capture snapshot in notification_workflow_versions
        if is_new_version and updated_wf:
            try:
                db.table("notification_workflow_versions").insert({
                    "workflow_id": workflow_id,
                    "version_number": new_version_num,
                    "title": updated_wf["title"],
                    "description": updated_wf.get("description"),
                    "trigger_lifecycle": updated_wf["trigger_lifecycle"],
                    "category": updated_wf["category"],
                    "filter_rules": updated_wf["filter_rules"],
                    "filter_match_type": updated_wf["filter_match_type"],
                    "notification_type": updated_wf["notification_type"],
                    "channels": updated_wf["channels"],
                    "delivery_policy": updated_wf.get("delivery_policy") or "PARALLEL",
                    "recipient_routing": updated_wf.get("recipient_routing", "LEARNER"),
                    "audience_filter": updated_wf.get("audience_filter", {}),
                    "pinned_template_id": updated_wf.get("pinned_template_id"),
                    "pinned_template_version_id": updated_wf.get("pinned_template_version_id"),
                    "title_template": updated_wf["title_template"],
                    "body_template": updated_wf["body_template"],
                    "cooldown_seconds": updated_wf["cooldown_seconds"],
                    "priority": updated_wf["priority"],
                    "content_fingerprint": new_fingerprint,
                    "published_by": auth_ctx.user_id,
                }).execute()
            except Exception as ve:
                logger.warning(f"Failed to record workflow version snapshot: {ve}")

        WorkflowEngine.invalidate_cache()

        return {
            "success": True,
            "workflow": updated_wf,
            "message": "Workflow updated successfully.",
            "version_created": is_new_version,
            "version_number": new_version_num,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update workflow {workflow_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{workflow_id}/versions")
async def get_workflow_versions(
    workflow_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Returns the immutable published version history for a workflow (strictly Developer role).
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()
        res = (
            db.table("notification_workflow_versions")
            .select("*")
            .eq("workflow_id", workflow_id)
            .order("version_number", desc=True)
            .execute()
        )
        return {
            "success": True,
            "workflow_id": workflow_id,
            "versions": res.data or [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/rollback")
async def rollback_workflow_version(
    workflow_id: str,
    request: WorkflowRollbackRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Rolls back a workflow to a previously published known-good version
    without mutating historical records.
    Enforces Developer Role verification.
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()

        # Find historical snapshot
        v_res = (
            db.table("notification_workflow_versions")
            .select("*")
            .eq("workflow_id", workflow_id)
            .eq("version_number", request.target_version)
            .maybe_single()
            .execute()
        )
        v_data = getattr(v_res, "data", None)
        if not v_data:
            raise HTTPException(
                status_code=404,
                detail=f"Version {request.target_version} not found for workflow {workflow_id}",
            )

        # Get current version
        wf_res = db.table("notification_workflows").select("version_number").eq("id", workflow_id).maybe_single().execute()
        current_ver = int((wf_res.data or {}).get("version_number") or 1)
        new_version_num = current_ver + 1

        restore_payload = {
            "title": v_data["title"],
            "description": v_data.get("description"),
            "trigger_lifecycle": v_data["trigger_lifecycle"],
            "category": v_data["category"],
            "filter_rules": v_data["filter_rules"],
            "filter_match_type": v_data["filter_match_type"],
            "notification_type": v_data["notification_type"],
            "channels": v_data["channels"],
            "delivery_policy": v_data.get("delivery_policy") or "PARALLEL",
            "recipient_routing": v_data.get("recipient_routing", "LEARNER"),
            "audience_filter": v_data.get("audience_filter", {}),
            "pinned_template_id": v_data.get("pinned_template_id"),
            "pinned_template_version_id": v_data.get("pinned_template_version_id"),
            "title_template": v_data["title_template"],
            "body_template": v_data["body_template"],
            "cooldown_seconds": v_data["cooldown_seconds"],
            "priority": v_data["priority"],
            "content_fingerprint": v_data["content_fingerprint"],
            "version_number": new_version_num,
            "is_active": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        res = db.table("notification_workflows").update(restore_payload).eq("id", workflow_id).execute()

        # Record restored snapshot
        db.table("notification_workflow_versions").insert({
            "workflow_id": workflow_id,
            "version_number": new_version_num,
            "title": v_data["title"],
            "description": v_data.get("description"),
            "trigger_lifecycle": v_data["trigger_lifecycle"],
            "category": v_data["category"],
            "filter_rules": v_data["filter_rules"],
            "filter_match_type": v_data["filter_match_type"],
            "notification_type": v_data["notification_type"],
            "channels": v_data["channels"],
            "delivery_policy": v_data.get("delivery_policy") or "PARALLEL",
            "recipient_routing": v_data.get("recipient_routing", "LEARNER"),
            "audience_filter": v_data.get("audience_filter", {}),
            "pinned_template_id": v_data.get("pinned_template_id"),
            "pinned_template_version_id": v_data.get("pinned_template_version_id"),
            "title_template": v_data["title_template"],
            "body_template": v_data["body_template"],
            "cooldown_seconds": v_data["cooldown_seconds"],
            "priority": v_data["priority"],
            "content_fingerprint": v_data["content_fingerprint"],
            "published_by": auth_ctx.user_id,
        }).execute()

        WorkflowEngine.invalidate_cache()

        return {
            "success": True,
            "message": f"Successfully rolled back workflow to version {request.target_version}. New active version is {new_version_num}.",
            "workflow": res.data[0] if res.data else None,
            "restored_from_version": request.target_version,
            "new_version": new_version_num,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rollback failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Deletes a workflow. Enforces Developer Role verification."""
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()
        db.table("notification_workflows").delete().eq("id", workflow_id).execute()
        WorkflowEngine.invalidate_cache()
        return {"success": True, "message": "Workflow deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class WorkflowStatusToggleRequest(BaseModel):
    is_active: bool

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


@router.patch("/{workflow_id}/status")
async def toggle_workflow_status(
    workflow_id: str,
    request: Optional[WorkflowStatusToggleRequest] = None,
    is_active: Optional[bool] = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Toggles active/paused state of a workflow. Enforces Developer Role verification."""
    await require_developer_role(auth_ctx.user_id)
    target_active = request.is_active if request is not None else is_active
    if target_active is None:
        raise HTTPException(status_code=422, detail="Field 'is_active' must be provided in JSON body or query param.")
    try:
        db = get_service_supabase_client()
        res = (
            db.table("notification_workflows")
            .update({
                "is_active": target_active,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", workflow_id)
            .execute()
        )
        WorkflowEngine.invalidate_cache()
        return {
            "success": True,
            "workflow": res.data[0] if res.data else None,
            "message": f"Workflow {'activated' if is_active else 'paused'}.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/simulate")
async def simulate_workflow(
    request: WorkflowSimulateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Simulates workflow execution for live preview in the Dispatch Center wizard (strictly Developer role).
    Tests filter matching, renders title/body templates, and validates delivery policy.
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        target_user = request.user_id or str(auth_ctx.user_id)

        # Enrich context
        context = await NotificationContextEnricher.enrich(
            user_id=target_user,
            base_payload=request.sample_payload,
            company_id=auth_ctx.company_id,
        )

        # Evaluate rules based on rule_mode
        rule_mode = (request.rule_mode or "THRESHOLD").upper()
        rules_as_dict = [r.dict() for r in request.filter_rules]
        mock_wf = {
            "filter_rules": rules_as_dict,
            "filter_match_type": request.filter_match_type,
            "audience_filter": request.audience_filter or {},
            "recipient_routing": request.recipient_routing or "LEARNER",
        }

        if rule_mode == "UNCONDITIONAL":
            matches = True
            active_branch = "UNCONDITIONAL"
            title_to_render = request.title_template
            body_to_render = request.body_template
        elif rule_mode == "DUAL_BRANCH":
            matches = WorkflowEngine.matches_filter_rules(mock_wf, context)
            if matches:
                active_branch = "TRUE"
                title_to_render = request.title_template
                body_to_render = request.body_template
            else:
                active_branch = "FALSE"
                title_to_render = request.secondary_title_template or request.title_template
                body_to_render = request.secondary_body_template or request.body_template
        else:  # THRESHOLD
            matches = WorkflowEngine.matches_filter_rules(mock_wf, context)
            active_branch = "TRUE" if matches else "FILTERED_OUT"
            title_to_render = request.title_template
            body_to_render = request.body_template

        # Render active branch templates
        rendered_title, unres_title = TemplateCompiler.render(title_to_render, context)
        rendered_body, unres_body = TemplateCompiler.render(body_to_render, context)

        return {
            "success": True,
            "rule_mode": rule_mode,
            "active_branch": active_branch,
            "matches_conditions": matches,
            "rendered_title": rendered_title,
            "rendered_body": rendered_body,
            "unresolved_variables": list(set(unres_title + unres_body)),
            "delivery_policy": request.delivery_policy or "PARALLEL",
            "resolved_context_sample": {
                k: str(v)
                for k, v in context.items()
                if not any(s in k.lower() for s in ["token", "secret", "password"])
            },
        }
    except Exception as e:
        logger.error(f"Workflow simulation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def resolve_audience_recipients(
    company_id: Optional[str],
    audience_filter: Optional[Dict[str, Any]] = None,
    routing: str = "LEARNER",
) -> List[Dict[str, Any]]:
    """Resolves matching active enrolled users for audience scoping and broadcasts."""
    db = get_service_supabase_client()
    audience_filter = audience_filter or {}
    depts = [d.strip().lower() for d in (audience_filter.get("departments") or []) if d]
    roles = [r.strip().lower() for r in (audience_filter.get("roles") or []) if r]
    routing_clean = str(routing or "LEARNER").upper()

    query = (
        db.table("users")
        .select("user_id, name, email, position, is_active, company_id, manager_id, function(function_name)")
        .eq("is_active", True)
    )
    if company_id:
        query = query.eq("company_id", company_id)

    res = query.execute()
    users = getattr(res, "data", []) or []
    if not users:
        return []

    # 1. Filter by Department if specified (matches against function_name or position)
    if depts:
        filtered = []
        for u in users:
            fn = ((u.get("function") or {}).get("function_name") or u.get("position") or "").lower()
            if any(d in fn for d in depts):
                filtered.append(u)
        users = filtered

    # 2. Filter by Role if specified or if MANAGER routing is requested
    if roles or routing_clean == "MANAGER":
        target_roles = roles or ["manager", "admin", "super_admin"]
        uids = [u["user_id"] for u in users]
        if not uids:
            return []

        try:
            ra_res = (
                db.table("user_role_assignments")
                .select("user_id, is_active, roles(name)")
                .in_("user_id", uids)
                .eq("is_active", True)
                .execute()
            )
            role_map = {}
            for ra in getattr(ra_res, "data", []) or []:
                uid = ra.get("user_id")
                r_name = ((ra.get("roles") or {}).get("name") or "").lower()
                if uid not in role_map:
                    role_map[uid] = set()
                role_map[uid].add(r_name)

            filtered_roles = []
            for u in users:
                uid = u["user_id"]
                u_roles = role_map.get(uid, set())
                if any(tr in u_roles for tr in target_roles):
                    filtered_roles.append(u)
            users = filtered_roles
        except Exception as re_err:
            logger.warning(f"Audience role filter fallback error: {re_err}, keeping all active users")

    return users


@router.post("/{workflow_id}/preview-audience")
@router.get("/{workflow_id}/preview-audience")
async def preview_workflow_audience(
    workflow_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Returns the count and sample of enrolled company users matching this workflow's audience scope.
    Used by the developer to verify reach before executing an immediate broadcast.
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()
        wf_res = db.table("notification_workflows").select("*").eq("id", workflow_id).maybe_single().execute()
        wf = getattr(wf_res, "data", None)
        if not wf:
            raise HTTPException(status_code=404, detail="Workflow not found")

        company_id = wf.get("company_id") or auth_ctx.company_id
        audience_filter = wf.get("audience_filter") or {}
        routing = wf.get("recipient_routing") or "LEARNER"

        matching_users = await resolve_audience_recipients(
            company_id=company_id,
            audience_filter=audience_filter,
            routing=routing,
        )
        total_count = len(matching_users)

        # Render preview with sample user
        sample_title = wf.get("title_template") or wf.get("title")
        sample_body = wf.get("body_template") or ""
        first_user = matching_users[0] if matching_users else None
        first_name = (first_user.get("name") or "").split(" ")[0] if first_user else "Learner"
        rendered_title, _ = TemplateCompiler.render(sample_title, {"subscriber.first_name": first_name, "first_name": first_name})
        rendered_body, _ = TemplateCompiler.render(sample_body, {"subscriber.first_name": first_name, "first_name": first_name})

        return {
            "success": True,
            "workflow_id": workflow_id,
            "workflow_title": wf.get("title"),
            "category": wf.get("category"),
            "channels": wf.get("channels") or ["IN_APP", "PUSH"],
            "total_recipients": total_count,
            "recipient_count": total_count,
            "count": total_count,
            "sample_recipients": [
                {
                    "id": str(u.get("user_id")),
                    "name": u.get("name") or "User",
                    "role": u.get("position") or "Employee",
                    "department": (u.get("function") or {}).get("function_name") or "General",
                }
                for u in matching_users[:12]
            ],
            "rendered_preview": {
                "title": rendered_title,
                "body": rendered_body,
            },
            "audience_filter": audience_filter,
            "recipient_routing": routing,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error previewing audience for workflow {workflow_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/broadcast")
async def broadcast_workflow(
    workflow_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Broadcasts / Sends Now this workflow immediately to all users matching its audience filter.
    Dispatches Mobile Push and In-App Bell notifications without waiting for lifecycle triggers.
    """
    await require_developer_role(auth_ctx.user_id)
    try:
        db = get_service_supabase_client()
        wf_res = db.table("notification_workflows").select("*").eq("id", workflow_id).maybe_single().execute()
        wf = getattr(wf_res, "data", None)
        if not wf:
            raise HTTPException(status_code=404, detail="Workflow not found")

        company_id = wf.get("company_id") or auth_ctx.company_id
        audience_filter = wf.get("audience_filter") or {}
        routing = wf.get("recipient_routing") or "LEARNER"

        matching_users = await resolve_audience_recipients(
            company_id=company_id,
            audience_filter=audience_filter,
            routing=routing,
        )

        if not matching_users:
            return {
                "success": True,
                "workflow_id": workflow_id,
                "dispatched_count": 0,
                "message": "No enrolled users matched the audience filter for this broadcast.",
            }

        trigger = wf.get("trigger_lifecycle") or "GENERAL_ANNOUNCEMENT"
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

        async def dispatch_single_recipient(u: Dict[str, Any]) -> bool:
            target_uid = str(u.get("user_id") or "")
            if not target_uid:
                return False
            first_name = (u.get("name") or "").split(" ")[0] or "there"
            dept_name = (u.get("function") or {}).get("function_name") or u.get("position") or "General"
            payload = {
                "subscriber.first_name": first_name,
                "first_name": first_name,
                "subscriber.full_name": u.get("name") or "Learner",
                "subscriber.department": dept_name,
                "subscriber.role": u.get("position") or "employee",
                "broadcast_time": now_str,
                "system.title": wf.get("title") or "Platform Announcement",
                "title": wf.get("title") or "Platform Announcement",
                "system.message": wf.get("description") or "Please check your portal for complete details.",
                "message": wf.get("description") or "Please check your portal for complete details.",
                "system.action_url": "/employee/dashboard",
                "action_url": "/employee/dashboard",
                "system.timestamp": now_str,
                "timestamp": now_str,
            }
            try:
                await WorkflowEngine.trigger_lifecycle(
                    trigger_lifecycle=trigger,
                    user_id=target_uid,
                    payload=payload,
                    company_id=company_id,
                )
                return True
            except Exception as single_err:
                logger.warning(f"Broadcast trigger failed for user {target_uid}: {single_err}")
                return False

        dispatch_results = await asyncio.gather(
            *(dispatch_single_recipient(u) for u in matching_users),
            return_exceptions=True,
        )
        dispatched = sum(1 for r in dispatch_results if r is True)

        # Update last_triggered_at and execution_count
        try:
            new_exec = (wf.get("execution_count") or 0) + dispatched
            db.table("notification_workflows").update({
                "execution_count": new_exec,
                "last_triggered_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", workflow_id).execute()
        except Exception:
            pass

        return {
            "success": True,
            "workflow_id": workflow_id,
            "workflow_title": wf.get("title"),
            "dispatched_count": dispatched,
            "channels": wf.get("channels") or ["IN_APP", "PUSH"],
            "message": f"Successfully broadcasted to {dispatched} recipients via Push & In-App Bell.",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Broadcast error for workflow {workflow_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CustomHookTriggerRequest(BaseModel):
    hook_key: str
    target_user_id: Optional[str] = None
    broadcast_to_audience: bool = False
    custom_payload: Dict[str, Any] = {}


@router.post("/trigger-hook")
async def trigger_custom_developer_hook(
    request: CustomHookTriggerRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Developer API to trigger any registered developer hook (e.g. APP_UPDATE_NOTICE, SYSTEM_ALERT, DEV_HEALTH_CHECK, DEV_CUSTOM_EVENT_1..5).
    Rejects arbitrary unsupported triggers to maintain system integrity.
    """
    await require_developer_role(auth_ctx.user_id)
    from utils.notifications.registry_contracts import SYSTEM_EVENT_PRESET_MAP
    clean_hook = request.hook_key.strip().upper()
    if clean_hook not in SYSTEM_EVENT_PRESET_MAP and not clean_hook.startswith("DEV_"):
        raise HTTPException(
            status_code=400,
            detail=f"Trigger hook '{clean_hook}' is not recognized or supported by the notification system. Please select a registered hook.",
        )

    db = get_service_supabase_client()
    company_id = auth_ctx.company_id

    if request.broadcast_to_audience:
        active_wfs = (
            db.table("notification_workflows")
            .select("*")
            .eq("trigger_lifecycle", clean_hook)
            .eq("is_active", True)
            .execute()
        )
        wfs = getattr(active_wfs, "data", []) or []
        if not wfs:
            return {
                "success": True,
                "dispatched_count": 0,
                "message": f"No active workflows found listening for hook '{clean_hook}'.",
            }

        primary_wf = wfs[0]
        return await broadcast_workflow(primary_wf["id"], auth_ctx)
    else:
        target_uid = request.target_user_id or str(auth_ctx.user_id)
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        merged_payload = {
            "system.timestamp": now_str,
            "timestamp": now_str,
            **request.custom_payload,
        }
        await WorkflowEngine.trigger_lifecycle(
            trigger_lifecycle=clean_hook,
            user_id=target_uid,
            payload=merged_payload,
            company_id=company_id,
        )
        return {
            "success": True,
            "hook_key": clean_hook,
            "target_user_id": target_uid,
            "message": f"Successfully fired hook '{clean_hook}' for user {target_uid}.",
        }
