import json
import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import redis_client
from utils.notifications.context_enricher import NotificationContextEnricher
from utils.notifications.template_engine import TemplateCompiler, normalize_token_key

logger = logging.getLogger("lucid.workflow_engine")

WORKFLOWS_CACHE_TTL = 60  # Cache active workflows for 60s


class WorkflowEngine:
    """
    Lucid Notification Workflow & Automation Engine.
    Evaluates no-code event triggers and filters configured in the Dispatch Center:
      1. Matches incoming domain lifecycle triggers against active workflows.
      2. Evaluates simple visual filter conditions (Score, Modality, Streak, Inactivity).
      3. Automatically enriches learner context (VARK, Gamification, Curriculum).
      4. Dispatches personalized notifications across In-App, Push, and Email.
    """

    @classmethod
    def get_cached_workflows_for_trigger(
        cls, trigger_lifecycle: str, company_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieves active workflows subscribed to a lifecycle hook with Redis cache.
        """
        cache_key = f"workflows:trigger:{trigger_lifecycle}:{company_id or 'all'}"
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

        try:
            db = get_service_supabase_client()
            query = (
                db.table("notification_workflows")
                .select("*")
                .eq("trigger_lifecycle", trigger_lifecycle)
                .eq("is_active", True)
            )
            if company_id:
                query = query.or_(f"company_id.eq.{company_id},company_id.is.null")

            res = query.execute()
            data = getattr(res, "data", []) or []

            try:
                redis_client.setex(cache_key, WORKFLOWS_CACHE_TTL, json.dumps(data))
            except Exception:
                pass

            return data
        except Exception as e:
            logger.error(f"Failed to fetch workflows for trigger '{trigger_lifecycle}': {e}")
            return []

    @classmethod
    def invalidate_cache(cls, trigger_lifecycle: Optional[str] = None):
        """Invalidates workflow caches across triggers."""
        try:
            if trigger_lifecycle:
                keys = redis_client.keys(f"workflows:trigger:{trigger_lifecycle}:*")
            else:
                keys = redis_client.keys("workflows:trigger:*")
            for k in keys:
                redis_client.delete(k)
        except Exception as e:
            logger.debug(f"Redis workflow cache invalidation error: {e}")

    @classmethod
    def evaluate_rule(cls, rule: Dict[str, Any], context: Dict[str, Any]) -> bool:
        """
        Evaluates a single filter rule against the enriched context.
        Supports typed comparisons: numbers, booleans, enums, lists, ranges (between), and relative dates.
        """
        field_raw = str(rule.get("field") or "").strip()
        op = str(rule.get("operator") or "==").strip().lower()
        expected = rule.get("value")

        if not field_raw:
            return True

        canonical_field = normalize_token_key(field_raw)
        actual = context.get(canonical_field)
        if actual is None:
            actual = context.get(field_raw)
        if actual is None and "." in canonical_field:
            actual = context.get(canonical_field.split(".")[-1])

        # Boolean unary checks do not require actual to be non-None
        if op in ["is_true", "is true", "true"]:
            return bool(actual is True or str(actual).strip().lower() in ["true", "1", "yes"])
        if op in ["is_false", "is false", "false"]:
            return bool(actual is False or str(actual).strip().lower() in ["false", "0", "no"])

        if actual is None:
            return False

        # Normalize boolean comparisons explicitly
        str_actual = str(actual).strip().lower()
        str_expected = str(expected).strip().lower() if expected is not None else ""

        is_actual_bool = isinstance(actual, bool) or str_actual in ["true", "false"]
        is_expected_bool = isinstance(expected, bool) or str_expected in ["true", "false"]

        if is_actual_bool and is_expected_bool:
            b_actual = actual if isinstance(actual, bool) else (str_actual == "true")
            b_expected = expected if isinstance(expected, bool) else (str_expected == "true")
            if op in ["==", "=", "equals", "is"]:
                return b_actual == b_expected
            elif op in ["!=", "<>", "not equal", "is not"]:
                return b_actual != b_expected

        # Range / Between comparison
        if op in ["between", "range"]:
            try:
                num_actual = float(actual)
                if isinstance(expected, (list, tuple)) and len(expected) >= 2:
                    return float(expected[0]) <= num_actual <= float(expected[1])
                elif isinstance(expected, str) and ("," in expected or "-" in expected):
                    sep = "," if "," in expected else "-"
                    parts = expected.split(sep)
                    return float(parts[0].strip()) <= num_actual <= float(parts[1].strip())
            except Exception:
                pass

        # Normalize numeric comparisons if applicable
        try:
            if not is_actual_bool and (
                isinstance(expected, (int, float))
                or (isinstance(expected, str) and expected.replace(".", "", 1).replace("-", "", 1).isdigit())
            ):
                num_actual = float(actual)
                num_expected = float(expected)
                if op in ["<", "lt", "less than"]:
                    return num_actual < num_expected
                elif op in ["<=", "lte", "less than or equal"]:
                    return num_actual <= num_expected
                elif op in [">", "gt", "greater than"]:
                    return num_actual > num_expected
                elif op in [">=", "gte", "greater than or equal"]:
                    return num_actual >= num_expected
                elif op in ["==", "=", "equals", "is"]:
                    return num_actual == num_expected
                elif op in ["!=", "<>", "not equal"]:
                    return num_actual != num_expected
        except Exception:
            pass

        # Relative days comparison (for deadlines / schedules)
        if op in ["within_days", "within days"]:
            try:
                days_limit = float(expected)
                # If actual is already days_left number
                if isinstance(actual, (int, float)) or (isinstance(actual, str) and actual.isdigit()):
                    return 0 <= float(actual) <= days_limit
                # If actual is ISO timestamp
                dt_actual = datetime.fromisoformat(str(actual).replace("Z", "+00:00"))
                diff_days = (dt_actual - datetime.now(timezone.utc)).total_seconds() / 86400.0
                return 0 <= diff_days <= days_limit
            except Exception:
                pass

        if op in ["overdue_by_days", "overdue by days"]:
            try:
                days_limit = float(expected)
                if isinstance(actual, (int, float)) or (isinstance(actual, str) and actual.isdigit()):
                    return float(actual) < 0 and abs(float(actual)) >= days_limit
                dt_actual = datetime.fromisoformat(str(actual).replace("Z", "+00:00"))
                diff_days = (datetime.now(timezone.utc) - dt_actual).total_seconds() / 86400.0
                return diff_days >= days_limit
            except Exception:
                pass

        # String / Enum comparisons
        if op in ["==", "=", "equals", "is"]:
            return str_actual == str_expected
        elif op in ["!=", "<>", "not equal", "is not"]:
            return str_actual != str_expected
        elif op in ["contains", "has"]:
            return str_expected in str_actual
        elif op in ["not_contains", "not contains"]:
            return str_expected not in str_actual
        elif op in ["starts with", "startswith"]:
            return str_actual.startswith(str_expected)
        elif op in ["ends with", "endswith"]:
            return str_actual.endswith(str_expected)
        elif op in ["in"]:
            allowed = [v.strip().lower() for v in str_expected.split(",") if v.strip()]
            return str_actual in allowed
        elif op in ["not_in", "not in"]:
            allowed = [v.strip().lower() for v in str_expected.split(",") if v.strip()]
            return str_actual not in allowed

        return False

    @classmethod
    def matches_filter_rules(
        cls, workflow: Dict[str, Any], context: Dict[str, Any]
    ) -> bool:
        """
        Evaluates all workflow filter conditions according to match type,
        including audience scoping (department, role, module) and nested rule groups.
        """
        # 1. Evaluate Audience Scope Filters (Department, Role, Module)
        audience = workflow.get("audience_filter") or {}
        if audience and isinstance(audience, dict):
            # Department filter
            dept_filters = audience.get("departments") or []
            if dept_filters and isinstance(dept_filters, list):
                user_dept = str(context.get("subscriber.department") or context.get("department") or "").strip().lower()
                allowed_depts = [d.strip().lower() for d in dept_filters if d and str(d).strip()]
                if allowed_depts and "all" not in allowed_depts and user_dept not in allowed_depts:
                    return False

            # Role filter
            role_filters = audience.get("roles") or []
            if role_filters and isinstance(role_filters, list):
                user_role = str(context.get("subscriber.role") or context.get("role") or "").strip().lower()
                allowed_roles = [r.strip().lower() for r in role_filters if r and str(r).strip()]
                if allowed_roles and "all" not in allowed_roles and user_role not in allowed_roles:
                    return False

            # Module / Sprint filter
            module_filters = audience.get("module_ids") or []
            if module_filters and isinstance(module_filters, list):
                current_mod_id = str(context.get("module_id") or context.get("curriculum.module_id") or "").strip()
                current_mod_name = str(context.get("curriculum.module_name") or context.get("module_name") or "").strip().lower()
                allowed_mods = [str(m).strip() for m in module_filters if m and str(m).strip()]
                if allowed_mods and not any(m == current_mod_id or m.lower() == current_mod_name for m in allowed_mods):
                    return False

        # 2. Evaluate Rule Conditions (with support for nested groups)
        rules = workflow.get("filter_rules") or []
        if not rules:
            return True

        def _evaluate_item(item: Dict[str, Any]) -> bool:
            if "group_rules" in item and isinstance(item["group_rules"], list):
                sub_match = str(item.get("match_type") or "ALL").upper()
                sub_rules = item.get("group_rules") or []
                if not sub_rules:
                    return True
                if sub_match == "ANY":
                    return any(_evaluate_item(sr) for sr in sub_rules)
                else:
                    return all(_evaluate_item(sr) for sr in sub_rules)
            return cls.evaluate_rule(item, context)

        match_type = str(workflow.get("filter_match_type") or "ALL").upper()
        if match_type == "ANY":
            return any(_evaluate_item(r) for r in rules)
        else:  # Default ALL (AND)
            return all(_evaluate_item(r) for r in rules)

    @classmethod
    async def trigger_lifecycle(
        cls,
        trigger_lifecycle: str,
        user_id: str,
        payload: Optional[Dict[str, Any]] = None,
        company_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Main entry point for Application Domain Lifecycle events.
        Matches and executes all active workflows for this lifecycle event.
        """
        from utils.notifications.event_bus import publish_event

        payload = payload or {}

        # 1. Enforce Strict Tenant Boundary & Recipient Validation
        from utils.notifications.policy_evaluator import NotificationPolicyEvaluator

        tenant_ok, tenant_reason, user_row = NotificationPolicyEvaluator.evaluate_tenant_isolation(
            event_company_id=company_id,
            recipient_user_id=user_id,
            manager_id=payload.get("manager_id"),
        )
        if not tenant_ok:
            logger.warning(f"WorkflowEngine trigger_lifecycle rejected for user {user_id}: {tenant_reason}")
            NotificationPolicyEvaluator.record_policy_audit(
                correlation_id=f"wf-leak-{uuid.uuid4().hex[:8]}",
                notification_type=trigger_lifecycle,
                recipient_user_id=user_id,
                company_id=company_id,
                status="REJECTED" if "LEAKAGE" in tenant_reason else "SUPPRESSED",
                suppression_reason=tenant_reason,
                details=payload,
            )
            return [{
                "workflow_id": None,
                "status": tenant_reason,
                "reason": f"Tenant boundary violation: {tenant_reason}",
            }]

        auth_company_id = user_row.get("company_id")

        # 2. Enforce Company Feature Entitlement Hard Gate via companies.subscription_addons
        entitled, req_addon, ent_reason = NotificationPolicyEvaluator.evaluate_company_entitlement(
            company_id=auth_company_id,
            trigger_or_event=trigger_lifecycle,
        )
        if not entitled:
            logger.info(
                f"WorkflowEngine trigger_lifecycle suppressed for user {user_id} in company {auth_company_id}: "
                f"{ent_reason} (Requires add-on: {req_addon})"
            )
            NotificationPolicyEvaluator.record_policy_audit(
                correlation_id=f"wf-ent-{uuid.uuid4().hex[:8]}",
                notification_type=trigger_lifecycle,
                recipient_user_id=user_id,
                company_id=auth_company_id,
                status="SUPPRESSED",
                suppression_reason=ent_reason,
                details={"required_addon": req_addon, "trigger_lifecycle": trigger_lifecycle},
            )
            return [{
                "workflow_id": None,
                "status": ent_reason,
                "reason": f"Company {auth_company_id} is not entitled to required feature '{req_addon}'",
            }]

        workflows = cls.get_cached_workflows_for_trigger(trigger_lifecycle, auth_company_id)
        if not workflows:
            logger.debug(f"No active workflows found for lifecycle '{trigger_lifecycle}'")
            return []

        # 3. Enrich Learner Context
        context = await NotificationContextEnricher.enrich(
            user_id=user_id,
            base_payload=payload,
            company_id=auth_company_id,
        )

        results = []
        db = get_service_supabase_client()

        for wf in workflows:
            wf_id = wf.get("id")
            wf_title = wf.get("title")

            # 2. Evaluate Filter Rules
            if not cls.matches_filter_rules(wf, context):
                logger.debug(
                    f"Workflow '{wf_title}' (id: {wf_id}) conditions did not match for user {user_id}."
                )
                continue

            # 3. Guardrail / Cooldown Check (Deduplication)
            cooldown = int(wf.get("cooldown_seconds") or 3600)
            if cooldown > 0:
                cooldown_key = f"throttle:workflow:{wf_id}:{user_id}"
                try:
                    if redis_client.exists(cooldown_key):
                        logger.info(
                            f"Workflow '{wf_title}' throttled for user {user_id} (cooldown {cooldown}s)."
                        )
                        results.append({
                            "workflow_id": wf_id,
                            "status": "THROTTLED",
                            "workflow_title": wf_title,
                        })
                        continue
                    redis_client.setex(cooldown_key, cooldown, "1")
                except Exception as ce:
                    logger.debug(f"Redis throttle error: {ce}")

            # 4. Dispatch Personalized Notification
            notif_type = wf.get("notification_type") or f"WF_{trigger_lifecycle}"
            channels = wf.get("channels") or ["IN_APP", "PUSH"]
            delivery_policy = wf.get("delivery_policy") or "PARALLEL"

            # Check if workflow has a pinned immutable template version or pinned template
            title_tpl = wf.get("title_template") or "Lucid Notification"
            body_tpl = wf.get("body_template") or "You have a new update."

            pinned_ver_id = wf.get("pinned_template_version_id")
            pinned_tpl_id = wf.get("pinned_template_id")
            if pinned_ver_id:
                try:
                    pv_res = (
                        db.table("notification_template_versions")
                        .select("title_template, body_template")
                        .eq("id", pinned_ver_id)
                        .maybe_single()
                        .execute()
                    )
                    if pv_res.data:
                        title_tpl = pv_res.data.get("title_template") or title_tpl
                        body_tpl = pv_res.data.get("body_template") or body_tpl
                except Exception as pve:
                    logger.debug(f"Failed to fetch pinned template version {pinned_ver_id}: {pve}")
            elif pinned_tpl_id:
                try:
                    pt_res = (
                        db.table("notification_templates")
                        .select("title_template, body_template, channel, notification_type")
                        .eq("id", pinned_tpl_id)
                        .maybe_single()
                        .execute()
                    )
                    if pt_res.data:
                        title_tpl = pt_res.data.get("title_template") or title_tpl
                        body_tpl = pt_res.data.get("body_template") or body_tpl
                        if pt_res.data.get("notification_type"):
                            notif_type = pt_res.data.get("notification_type")
                except Exception as pte:
                    logger.debug(f"Failed to fetch pinned template {pinned_tpl_id}: {pte}")

            rendered_title, unres_title = TemplateCompiler.render(title_tpl, context)
            rendered_body, unres_body = TemplateCompiler.render(body_tpl, context)

            # Strict Execution: Skip delivery if required personalized variables are missing
            missing_reqs = list(set((unres_title or []) + (unres_body or [])))
            if missing_reqs:
                logger.warning(
                    f"Strict Execution: Workflow '{wf_title}' (id: {wf_id}) skipped for user {user_id} "
                    f"due to missing required variables: {missing_reqs}"
                )
                try:
                    db.table("notification_dispatch_audit").insert({
                        "correlation_id": f"wf-skip-{wf_id}-{uuid.uuid4().hex[:8]}",
                        "template_id": pinned_tpl_id if pinned_tpl_id else None,
                        "notification_type": notif_type,
                        "channel": channels[0] if channels else "IN_APP",
                        "recipient_user_id": user_id,
                        "status": "VALIDATION_FAILED",
                        "failure_reason": f"Strict Execution: Delivery skipped because required variables are missing: {', '.join(missing_reqs)}",
                        "validation_errors": missing_reqs,
                        "resolved_variables": {k: context.get(k) for k in list(context.keys())[:20]},
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }).execute()
                except Exception as audit_err:
                    logger.debug(f"Failed to write missing variables audit record: {audit_err}")

                results.append({
                    "workflow_id": wf_id,
                    "workflow_title": wf_title,
                    "status": "SKIPPED_MISSING_VARIABLES",
                    "missing_variables": missing_reqs,
                })
                continue

            # 4. Resolve Recipient Routing (Learner, Manager Escalation, or Both)
            recipient_routing = str(wf.get("recipient_routing") or "LEARNER").upper()
            target_recipients = [user_id]

            manager_id = (
                payload.get("manager_id")
                or context.get("manager_id")
                or (user_row.get("manager_id") if user_row else None)
            )

            if recipient_routing == "MANAGER":
                if manager_id:
                    target_recipients = [manager_id]
                else:
                    logger.info(f"Workflow {wf_id} specified MANAGER routing, but user {user_id} has no manager. Fallback to learner.")
                    target_recipients = [user_id]
            elif recipient_routing == "BOTH":
                if manager_id and manager_id != user_id:
                    target_recipients = [user_id, manager_id]

            dispatch_records = []
            for target_user_id in target_recipients:
                is_escalation = (target_user_id == manager_id and target_user_id != user_id)
                msg_title = f"[Escalation] {rendered_title}" if is_escalation else rendered_title

                dispatch_payload = {
                    **context,
                    "workflow_id": wf_id,
                    "workflow_title": wf_title,
                    "category": wf.get("category"),
                    "company_id": auth_company_id,
                    "target_screen": payload.get("target_screen") or "Home",
                    "custom_title": msg_title,
                    "custom_body": rendered_body,
                    "channels": channels,
                    "delivery_policy": delivery_policy,
                    "pinned_template_id": pinned_tpl_id,
                    "pinned_template_version_id": pinned_ver_id,
                    "is_manager_escalation": is_escalation,
                }

                dispatch_res = await publish_event(
                    event_key=notif_type,
                    recipient_user_id=target_user_id,
                    payload=dispatch_payload,
                    entity_id=payload.get("entity_id") or str(wf_id),
                )
                dispatch_records.append({"recipient_id": target_user_id, "result": dispatch_res})

            # 5. Record Execution Telemetry
            try:
                db.table("notification_workflows").update({
                    "execution_count": int(wf.get("execution_count") or 0) + 1,
                    "last_triggered_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", wf_id).execute()
            except Exception as te:
                logger.debug(f"Failed to update workflow execution stats: {te}")

            results.append({
                "workflow_id": wf_id,
                "workflow_title": wf_title,
                "status": "TRIGGERED",
                "recipient_routing": recipient_routing,
                "dispatches": dispatch_records,
            })

        return results

    @classmethod
    async def recheck_conditions_before_send(
        cls,
        workflow_id: str,
        user_id: str,
        base_payload: Optional[Dict[str, Any]] = None,
        company_id: Optional[str] = None,
    ) -> tuple[bool, str]:
        """
        Phase 7.6 Stale-State Check:
        Evaluates current business state before a delayed or recurring notification is dispatched.
        Returns (is_valid, reason). If condition is no longer met (e.g. task completed or streak kept),
        the notification is safely suppressed.
        """
        try:
            db = get_service_supabase_client()
            wf_res = (
                db.table("notification_workflows")
                .select("*")
                .eq("id", workflow_id)
                .maybe_single()
                .execute()
            )
            wf = getattr(wf_res, "data", None)
            if not wf:
                return True, "WORKFLOW_NOT_FOUND"

            if not wf.get("is_active"):
                return False, "WORKFLOW_PAUSED"

            # Re-verify tenant membership and company feature entitlement at stale-state check
            from utils.notifications.policy_evaluator import NotificationPolicyEvaluator
            tenant_ok, tenant_reason, user_row = NotificationPolicyEvaluator.evaluate_tenant_isolation(
                event_company_id=company_id,
                recipient_user_id=user_id,
            )
            if not tenant_ok:
                logger.info(f"[StaleCheck] Tenant boundary violation for user {user_id}: {tenant_reason}")
                return False, tenant_reason

            auth_company = user_row.get("company_id") or company_id
            entitled, req_addon, ent_reason = NotificationPolicyEvaluator.evaluate_company_entitlement(
                company_id=auth_company,
                trigger_or_event=wf.get("trigger_lifecycle") or wf.get("notification_type") or "",
                category=wf.get("category"),
            )
            if not entitled:
                logger.info(f"[StaleCheck] Suppressing delayed notification: company {auth_company} not entitled ({ent_reason})")
                return False, ent_reason

            # Freshly enrich latest permitted context from authoritative tables
            context = await NotificationContextEnricher.enrich(
                user_id=user_id,
                base_payload=base_payload or {},
                company_id=auth_company,
            )

            if not cls.matches_filter_rules(wf, context):
                logger.info(
                    f"[StaleCheck] Suppressing delayed notification: workflow '{wf.get('title')}' conditions no longer met for user {user_id}."
                )
                return False, "CONDITION_NO_LONGER_MET"

            return True, "CONDITIONS_VALID"
        except Exception as e:
            logger.warning(f"Error during pre-send stale state recheck: {e}")
            return True, "RECHECK_ERROR_PERMITTED"

