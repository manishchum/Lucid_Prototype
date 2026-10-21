import json
import logging
import uuid
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import redis_client

logger = logging.getLogger("lucid.policy_evaluator")

COMPANY_ADDONS_CACHE_TTL = 60  # Cache company subscription addons for 60 seconds

from routes.companies import ALLOWED_ADDONS

# Canonical mappings from trigger lifecycle / event category to required subscription add-on
CATEGORY_ADDON_MAP: Dict[str, str] = {
    "GAMIFICATION": "gamification",
    "TASKS": "task_management",
    "ROLEPLAY": "role_play",
    "CONTENT": "lucid_studio",
    "CONTENT_LIBRARY": "lucid_studio",
    "STUDIO": "lucid_studio",
    "KPI": "kpi",
    "REPORTS": "reports",
    "CHAT": "chat_in_studio",
    "CHAT_IN_STUDIO": "chat_in_studio",
    "BASELINE": "baseline_assessment",
    "VOICE_AGENT": "voice_agent",
    "SPRINTVERSE": "sprintverse",
}

TRIGGER_ADDON_MAP: Dict[str, str] = {
    # Gamification
    "GAMIFICATION_SPRINT_READY": "gamification",
    "GAMIFICATION_DRILL_REMINDER": "gamification",
    "DAILY_STREAK_CHECK": "gamification",
    "STREAK_MILESTONE": "gamification",
    "BADGE_UNLOCKED": "gamification",
    "LEADERBOARD_ALERT": "gamification",
    "DRILL_COMPLETED": "gamification",
    # AI Roleplay
    "ROLEPLAY_ASSIGNED": "role_play",
    "ROLEPLAY_REPORT_READY": "role_play",
    "ROLEPLAY_RETAKE": "role_play",
    "ROLEPLAY_SESSION_COMPLETED": "role_play",
    # Tasks
    "TASK_ASSIGNED": "task_management",
    "TASK_EVALUATED": "task_management",
    "TASK_DUE_REMINDER": "task_management",
    "TASK_OVERDUE": "task_management",
    "TASK_SUBMITTED": "task_management",
    # Studio Media & Sub-features
    "PODCAST_EPISODE_READY": "lucid_studio_podcast",
    "STUDIO_PODCAST_READY": "lucid_studio_podcast",
    "STUDIO_VIDEO_READY": "lucid_studio_video",
    "STUDIO_MINDMAP_READY": "lucid_studio_mindmap",
    "STUDIO_INFOGRAPHIC_READY": "lucid_studio_infographic",
    "STUDIO_FLASHCARD_READY": "lucid_studio_flashcard",
    "STUDIO_TEXTUAL_READY": "lucid_studio_textual",
    # Studio Chat
    "CHAT_STUDIO_TEXT_READY": "chat_in_studio_textual",
    "CHAT_STUDIO_SPEECH_READY": "chat_in_studio_speech",
    # Other specialized add-ons from ALLOWED_ADDONS
    "SPRINTVERSE_SESSION": "sprintverse",
    "BASELINE_ASSESSMENT_COMPLETED": "baseline_assessment",
    "VOICE_AGENT_READY": "voice_agent",
    "KPI_MILESTONE_REACHED": "kpi",
    "EXECUTIVE_REPORT_READY": "reports",
}

# Core platform categories and triggers that are always entitled (unless trigger overrides above)
CORE_CATEGORIES = {
    "ONBOARDING",
    "SPRINT_ASSIGNMENT",
    "CURRICULUM",
    "QUIZZES",
    "ASSESSMENT",
    "DEADLINES",
    "RE_ENGAGEMENT",
    "ENGAGEMENT",
    "ANNOUNCEMENTS_INFO",
    "SYSTEM",
    "GENERAL",
}

CORE_TRIGGERS = {
    # Onboarding
    "USER_WELCOME",
    "LEARNING_STYLE_DISCOVERED",
    # Sprints
    "MODULE_ASSIGNED",
    "MODULE_ASSIGNMENT",
    "MODULE_PROGRESS_UPDATED",
    "COURSE_COMPLETED",
    # Quizzes
    "ASSESSMENT_COMPLETED",
    "QUIZ_PASSED",
    "QUIZ_FAILED",
    "MODULE_PASSED",
    "MODULE_FAILED",
    "QUIZ_WAITING_REMINDER",
    "POST_COMPLETION_FEEDBACK",
    # Deadlines
    "MODULE_DUE_REMINDER",
    "MODULE_OVERDUE",
    "DEADLINE_MISSED",
    "DEADLINE_24H",
    "DEADLINE_48H",
    # Re-engagement
    "DAILY_NUDGE",
    "SCHEDULED_SCAN",
    "POST_ASSIGNMENT_NUDGE",
    "REENGAGEMENT",
    # Announcements & General Info
    "GENERAL_ANNOUNCEMENT",
    "TEAM_CHECKIN_NUDGE",
    "SYSTEM_ALERT",
    "APP_UPDATE_NOTICE",
    "DEV_HEALTH_CHECK",
    "DEV_CUSTOM_EVENT_1",
    "DEV_CUSTOM_EVENT_2",
    "DEV_CUSTOM_EVENT_3",
    "DEV_CUSTOM_EVENT_4",
    "DEV_CUSTOM_EVENT_5",
    # Content Library & Reports
    "NEW_CONTENT_UPLOADED",
    "SPRINT_REPORT_GENERATED",
    "ROLEPLAY_REPORT_GENERATED",
    "RECOMMENDED_CONTENT",
    "CERTIFICATE_ISSUED",
}

CRITICAL_SECURITY_EVENTS = {
    "SYSTEM_SECURITY_ALERT",
    "SECURITY_ALERT",
    "PASSWORD_RESET",
    "ACCOUNT_LOCKED",
    "CRITICAL_SECURITY_NOTICE",
    "LEGAL_COMPLIANCE_NOTICE",
}


class NotificationPolicyEvaluator:
    """
    Centralized Enterprise Policy & Governance Evaluator.
    Enforces the strict 4-level precedence hierarchy:
      Level 1: Strict Recipient Scoping & Tenant Isolation (Hard Gate)
      Level 2: Company Feature Entitlement via companies.subscription_addons (Hard Gate)
      Level 3: Global Disabled-Event Controls (Hard Gate)
      Level 4: User Notification Category & Channel Preferences (Soft Gate with Critical Exception)
    """

    @classmethod
    def get_company_addons(cls, company_id: str) -> Optional[List[str]]:
        """
        Retrieves company subscription addons with Redis caching (60s TTL).
        Returns None if company does not exist or lookup fails.
        """
        if not company_id:
            return None

        cache_key = f"company:addons:{company_id}"
        try:
            cached = redis_client.get(cache_key)
            if cached is not None:
                return json.loads(cached)
        except Exception as e:
            logger.debug(f"Redis get company addons error: {e}")

        try:
            db = get_service_supabase_client()
            res = (
                db.table("companies")
                .select("subscription_addons")
                .eq("company_id", company_id)
                .maybe_single()
                .execute()
            )
            data = getattr(res, "data", None)
            if data is None:
                return None

            addons = data.get("subscription_addons") or []
            if not isinstance(addons, list):
                addons = []

            # Normalize to lowercase strings
            normalized = [str(a).strip().lower() for a in addons if a]
            try:
                redis_client.setex(cache_key, COMPANY_ADDONS_CACHE_TTL, json.dumps(normalized))
            except Exception as ce:
                logger.debug(f"Redis set company addons error: {ce}")

            return normalized
        except Exception as err:
            logger.error(f"Failed to fetch subscription addons for company {company_id}: {err}")
            return None

    @classmethod
    def invalidate_company_addons_cache(cls, company_id: str) -> None:
        """Evicts company addons from Redis cache when subscriptions change."""
        if not company_id:
            return
        try:
            redis_client.delete(f"company:addons:{company_id}")
            logger.info(f"Invalidated company addons cache for company {company_id}")
        except Exception as e:
            logger.debug(f"Failed to invalidate company addons cache: {e}")

    @classmethod
    def resolve_required_addon(cls, trigger_or_event: str, category: Optional[str] = None) -> Optional[str]:
        """
        Determines the canonical add-on required by a trigger or category.
        Returns:
          - Canonical add-on identifier (e.g., 'gamification', 'role_play', 'task_management')
          - None if it is a core platform feature that is always entitled
          - '__UNKNOWN_FEATURE__' if the trigger/category is unrecognized (to fail closed)
        """
        raw_key = trigger_or_event.strip().upper()
        # Strip WF_ prefix if present
        clean_key = raw_key[3:] if raw_key.startswith("WF_") else raw_key

        cat = (category or "").strip().upper()

        # 1. Check direct match with ALLOWED_ADDONS
        clean_lower = clean_key.lower().replace("-", "_")
        if clean_lower in ALLOWED_ADDONS:
            return clean_lower

        # 2. Check trigger override first
        if clean_key in TRIGGER_ADDON_MAP:
            return TRIGGER_ADDON_MAP[clean_key]

        # 3. Check category mapping
        if cat in CATEGORY_ADDON_MAP:
            return CATEGORY_ADDON_MAP[cat]

        # 4. Check if clean_key or cat is in Core
        if clean_key in CORE_TRIGGERS or cat in CORE_CATEGORIES:
            return None

        # 5. Infer from keywords
        if any(w in clean_key for w in ["STREAK", "XP", "BADGE", "LEADERBOARD"]):
            return "gamification"
        if any(w in clean_key for w in ["ROLEPLAY", "VOICE_SIMULATION"]):
            return "role_play"
        if any(w in clean_key for w in ["TASK_", "SUBMISSION"]):
            return "task_management"
        if any(w in clean_key for w in ["KPI"]):
            return "kpi"
        if any(w in clean_key for w in ["REPORT"]):
            return "reports"

        # If completely unknown, return sentinel to fail closed
        return "__UNKNOWN_FEATURE__"

    @classmethod
    def evaluate_company_entitlement(
        cls, company_id: Optional[str], trigger_or_event: str, category: Optional[str] = None
    ) -> Tuple[bool, Optional[str], str]:
        """
        Hard Gate: Validates company subscription entitlement via companies.subscription_addons.
        Returns (is_entitled, required_addon, reason). Fail closed.
        """
        if not company_id:
            return False, None, "SUPPRESSED_MISSING_COMPANY_ID"

        required_addon = cls.resolve_required_addon(trigger_or_event, category)

        # Core features are always entitled
        if required_addon is None:
            return True, None, "CORE_PLATFORM_ENTITLED"

        # Unknown features fail closed
        if required_addon == "__UNKNOWN_FEATURE__":
            return False, None, "SUPPRESSED_UNKNOWN_CATEGORY_NOT_ENTITLED"

        company_addons = cls.get_company_addons(company_id)
        if company_addons is None:
            return False, required_addon, "SUPPRESSED_COMPANY_NOT_FOUND"

        # Direct match in company addons
        if required_addon in company_addons:
            return True, required_addon, "ENTITLED"

        # Roleplay matches base role_play or vendor variants
        if required_addon == "role_play":
            has_roleplay = any(
                a in company_addons for a in ["role_play", "role_play_openai", "role_play_gemini"]
            )
            if has_roleplay:
                return True, required_addon, "ENTITLED"
            return False, required_addon, "SUPPRESSED_FEATURE_NOT_ENTITLED"

        # Parent-child add-on relations
        parent_map = {
            "lucid_studio_textual": "lucid_studio",
            "lucid_studio_podcast": "lucid_studio",
            "lucid_studio_video": "lucid_studio",
            "lucid_studio_mindmap": "lucid_studio",
            "lucid_studio_infographic": "lucid_studio",
            "lucid_studio_flashcard": "lucid_studio",
            "lucid_studio_flashcards": "lucid_studio",
            "chat_in_studio_textual": "chat_in_studio",
            "chat_in_studio_speech": "chat_in_studio",
            "task_management_textual": "task_management",
            "task_management_image": "task_management",
            "task_management_evaluation": "task_management",
            "task_management_audio": "task_management",
            "task_management_video": "task_management",
            "role_play_openai": "role_play",
            "role_play_gemini": "role_play",
        }
        parent = parent_map.get(required_addon)
        if parent and parent in company_addons:
            return True, required_addon, "ENTITLED"

        return False, required_addon, "SUPPRESSED_FEATURE_NOT_ENTITLED"

    @classmethod
    def evaluate_tenant_isolation(
        cls,
        event_company_id: Optional[str],
        recipient_user_id: str,
        manager_id: Optional[str] = None,
        recipient_user_row: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Hard Gate: Server-side validation of tenant boundary.
        - Ensures recipient belongs to event_company_id (rejects cross-tenant leaks).
        - Ensures recipient is active.
        - If manager_id is specified, ensures manager belongs to same company and is active.
        """
        db = get_service_supabase_client()
        user_row = recipient_user_row

        if not user_row:
            try:
                res = (
                    db.table("users")
                    .select("user_id, company_id, name, email, is_active, manager_id")
                    .eq("user_id", recipient_user_id)
                    .maybe_single()
                    .execute()
                )
                user_row = getattr(res, "data", None)
            except Exception as e:
                logger.error(f"Error fetching user for tenant check: {e}")
                return False, "SUPPRESSED_USER_LOOKUP_ERROR", {}

        if not user_row:
            return False, "SUPPRESSED_USER_NOT_FOUND", {}

        if user_row.get("is_active") is False:
            return False, "SUPPRESSED_USER_INACTIVE", user_row

        user_company_id = str(user_row.get("company_id") or "")
        if not user_company_id:
            return False, "SUPPRESSED_USER_NO_TENANT", user_row

        # Enforce event company matching if provided
        if event_company_id:
            clean_event_comp = str(event_company_id).strip()
            if clean_event_comp and clean_event_comp != user_company_id:
                logger.error(
                    f"Tenant Isolation Violation: Recipient {recipient_user_id} in company {user_company_id} "
                    f"does not match event company {clean_event_comp}!"
                )
                return False, "REJECTED_CROSS_TENANT_LEAKAGE", user_row

        # Enforce Manager Escalation Safety if manager_id provided or target is manager
        eval_manager_id = manager_id or user_row.get("manager_id")
        if manager_id:  # Explicit manager check requested
            try:
                m_res = (
                    db.table("users")
                    .select("user_id, company_id, is_active, name, email")
                    .eq("user_id", manager_id)
                    .maybe_single()
                    .execute()
                )
                m_row = getattr(m_res, "data", None)
                if not m_row:
                    return False, "SUPPRESSED_INVALID_MANAGER", user_row
                if m_row.get("is_active") is False:
                    return False, "SUPPRESSED_INVALID_MANAGER", user_row
                if str(m_row.get("company_id") or "") != user_company_id:
                    return False, "SUPPRESSED_INVALID_MANAGER", user_row
            except Exception as me:
                logger.error(f"Manager validation error: {me}")
                return False, "SUPPRESSED_INVALID_MANAGER", user_row

        return True, "TENANT_VALIDATED", user_row

    @classmethod
    def evaluate_global_controls(
        cls, event_key: str, allow_emergency_override: bool = False
    ) -> Tuple[bool, str]:
        """
        Hard Gate: Global matrix kill-switch and preset pause checks.
        """
        from utils.notifications.event_bus import get_cached_disabled_event_keys, get_cached_event_preset

        disabled_keys = get_cached_disabled_event_keys()
        clean_key = event_key[3:] if event_key.startswith("WF_") else event_key

        if event_key in disabled_keys or clean_key in disabled_keys:
            if allow_emergency_override:
                return True, "ALLOWED_EMERGENCY_OVERRIDE"
            return False, "SUPPRESSED_GLOBAL_EVENT_DISABLED"

        preset = get_cached_event_preset(clean_key)
        if preset and preset.get("is_enabled") is False:
            return False, "SUPPRESSED_EVENT_PRESET_PAUSED"

        return True, "GLOBAL_CONTROLS_PERMITTED"

    @classmethod
    def evaluate_user_preferences(
        cls,
        user_id: str,
        trigger_or_event: str,
        category: Optional[str] = None,
        channels: Optional[List[str]] = None,
        is_critical: bool = False,
    ) -> Tuple[bool, List[str], str]:
        """
        Soft Gate: User notification category and channel opt-outs.
        Supports narrowly defined CRITICAL / SECURITY exceptions.
        """
        clean_key = trigger_or_event[3:] if trigger_or_event.startswith("WF_") else trigger_or_event
        cat = (category or "").upper()
        target_channels = channels or ["IN_APP", "PUSH"]

        # Critical / Security exception bypasses user category preferences
        if is_critical or clean_key in CRITICAL_SECURITY_EVENTS or cat == "SECURITY":
            return True, target_channels, "ALLOWED_CRITICAL_POLICY_EXCEPTION"

        db = get_service_supabase_client()
        prefs: Dict[str, Any] = {}
        try:
            p_res = (
                db.table("notification_preferences")
                .select("*")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            prefs = getattr(p_res, "data", None) or {}
        except Exception as e:
            logger.debug(f"User preferences lookup error: {e}")

        # Check Category Preferences
        if cat == "GAMIFICATION" or any(w in clean_key for w in ["STREAK", "XP", "BADGE", "LEADERBOARD"]):
            if prefs.get("streak_notifications_enabled") is False:
                return False, [], "SUPPRESSED_USER_CATEGORY_OPT_OUT"

        if any(w in clean_key for w in ["DEADLINE", "DUE", "OVERDUE", "REMINDER"]):
            if prefs.get("deadline_reminders_enabled") is False:
                return False, [], "SUPPRESSED_USER_CATEGORY_OPT_OUT"

        if any(w in clean_key for w in ["FEEDBACK", "POST_COMPLETION"]):
            if prefs.get("post_completion_enabled") is False:
                return False, [], "SUPPRESSED_USER_CATEGORY_OPT_OUT"

        # Check Channel Preferences
        eligible_channels = []
        for ch in target_channels:
            ch_upper = ch.upper()
            if ch_upper == "IN_APP" and prefs.get("in_app_enabled") is not False:
                eligible_channels.append("IN_APP")
            elif ch_upper == "PUSH" and prefs.get("push_enabled") is not False:
                eligible_channels.append("PUSH")
            elif ch_upper == "EMAIL" and prefs.get("email_enabled") is not False:
                eligible_channels.append("EMAIL")
            elif ch_upper == "WHATSAPP" and prefs.get("whatsapp_enabled") is True:
                eligible_channels.append("WHATSAPP")

        if not eligible_channels and target_channels:
            return False, [], "SUPPRESSED_USER_CHANNEL_OPT_OUT"

        return True, eligible_channels, "ALLOWED_USER_PREFERENCES"

    @classmethod
    async def evaluate_full_policy(
        cls,
        event_company_id: Optional[str],
        recipient_user_id: str,
        trigger_or_event: str,
        category: Optional[str] = None,
        channels: Optional[List[str]] = None,
        manager_id: Optional[str] = None,
        is_critical: bool = False,
        allow_emergency_override: bool = False,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Executes the full enterprise policy pipeline in strict precedence order:
          Step 1: Strict Recipient Scoping & Tenant Isolation (Hard Gate)
          Step 2: Company Feature Entitlement via subscription_addons (Hard Gate)
          Step 3: Global Disabled-Event Controls (Hard Gate)
          Step 4: User Notification Category Preferences (Soft Gate with Critical Exception)
        Returns: (is_allowed, reason_code, context_dict)
        """
        # Step 1: Tenant Isolation
        tenant_ok, tenant_reason, user_row = cls.evaluate_tenant_isolation(
            event_company_id=event_company_id,
            recipient_user_id=recipient_user_id,
            manager_id=manager_id,
        )
        if not tenant_ok:
            return False, tenant_reason, {"user": user_row}

        authorized_company_id = str(user_row.get("company_id") or event_company_id)

        # Step 2: Company Feature Entitlement Hard Gate
        entitled, required_addon, ent_reason = cls.evaluate_company_entitlement(
            company_id=authorized_company_id,
            trigger_or_event=trigger_or_event,
            category=category,
        )
        if not entitled:
            return False, ent_reason, {
                "company_id": authorized_company_id,
                "required_addon": required_addon,
                "user": user_row,
            }

        # Step 3: Global Disabled-Event Controls Hard Gate
        global_ok, global_reason = cls.evaluate_global_controls(
            event_key=trigger_or_event,
            allow_emergency_override=allow_emergency_override,
        )
        if not global_ok:
            return False, global_reason, {
                "company_id": authorized_company_id,
                "user": user_row,
            }

        # Step 4: User Category & Channel Preferences
        pref_ok, active_channels, pref_reason = cls.evaluate_user_preferences(
            user_id=recipient_user_id,
            trigger_or_event=trigger_or_event,
            category=category,
            channels=channels,
            is_critical=is_critical,
        )
        if not pref_ok:
            return False, pref_reason, {
                "company_id": authorized_company_id,
                "user": user_row,
                "active_channels": active_channels,
            }

        return True, pref_reason, {
            "company_id": authorized_company_id,
            "user": user_row,
            "required_addon": required_addon,
            "active_channels": active_channels,
        }

    @classmethod
    def record_policy_audit(
        cls,
        correlation_id: str,
        notification_type: str,
        recipient_user_id: str,
        company_id: Optional[str],
        status: str,
        suppression_reason: str,
        channel: str = "ALL",
        details: Optional[Dict[str, Any]] = None,
        is_test: bool = False,
    ) -> None:
        """
        Records an auditable reason code directly to notification_dispatch_audit.
        """
        try:
            db = get_service_supabase_client()
            record = {
                "correlation_id": correlation_id or f"audit_{uuid.uuid4().hex[:12]}",
                "notification_type": notification_type,
                "channel": channel,
                "recipient_user_id": recipient_user_id,
                "status": status,
                "suppression_reason": suppression_reason,
                "failure_reason": suppression_reason if status in ["SUPPRESSED", "REJECTED", "FAILED"] else None,
                "is_test": is_test,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            if details and isinstance(details, dict):
                # Sanitize details
                safe_details = {k: str(v) for k, v in details.items() if not any(s in k.lower() for s in ["pass", "token", "secret"])}
                record["resolved_variables"] = safe_details

            db.table("notification_dispatch_audit").insert(record).execute()
            logger.info(f"[{correlation_id}] Policy Audit Recorded: {status} -> {suppression_reason}")
        except Exception as e:
            logger.warning(f"Failed to record policy audit: {e}")
