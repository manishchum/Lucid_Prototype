import json
import hashlib
import logging
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
    value: Any


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
    pinned_template_id: Optional[str] = None
    pinned_template_version_id: Optional[str] = None
    secondary_template_id: Optional[str] = None
    title_template: str = Field(..., min_length=1)
    body_template: str = Field(..., min_length=1)
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

        fingerprint = compute_workflow_fingerprint(
            trigger_lifecycle=request.trigger_lifecycle,
            filter_rules=rules_as_dict,
            filter_match_type=request.filter_match_type,
            notification_type=notif_key,
            channels=request.channels,
            delivery_policy=delivery_pol,
            title_template=request.title_template,
            body_template=request.body_template,
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
            "pinned_template_id": request.pinned_template_id,
            "pinned_template_version_id": request.pinned_template_version_id,
            "secondary_template_id": request.secondary_template_id,
            "title_template": request.title_template.strip(),
            "body_template": request.body_template.strip(),
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
