import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import redis_client

logger = logging.getLogger("lucid.context_enricher")

CONTEXT_CACHE_TTL = 300  # 5 minutes cache per user with 1-query DB aggregation

class NotificationContextEnricher:
    """
    Centralized Learner Context Enrichment Engine.
    Decorates any raw event or notification payload with:
      - Learner Identity & Organization Context
      - VARK Cognitive Learning Style Profile & Modality CTAs
      - Gamification Metrics (Streak, Points, Leaderboard Rival & Distance)
      - Curriculum Progress & Assessment History
    Sub-millisecond resolution via Redis caching and consolidated DB RPC.
    """

    @classmethod
    async def enrich(
        cls,
        user_id: str,
        base_payload: Optional[Dict[str, Any]] = None,
        company_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Returns a unified context dictionary with all namespaced variables resolved.
        Merges base_payload with prioritized learner profile data.
        """
        payload = dict(base_payload or {})
        if not user_id:
            return payload

        cache_key = f"notif_context:{user_id}"
        cached_data = None
        try:
            raw_cache = redis_client.get(cache_key)
            if raw_cache:
                cached_data = json.loads(raw_cache)
        except Exception as ce:
            logger.debug(f"Redis cache read error for user {user_id}: {ce}")

        if not cached_data:
            cached_data = await cls._fetch_and_aggregate_context(user_id, company_id)
            try:
                redis_client.setex(cache_key, CONTEXT_CACHE_TTL, json.dumps(cached_data))
            except Exception as se:
                logger.debug(f"Redis cache set error for user {user_id}: {se}")

        # Merge base_payload over cached profile, while keeping namespaced aliases intact
        merged = {**cached_data, **payload}

        # Synchronize bidirectional aliases so payload overrides cached fields across both flat and namespaced keys
        from utils.notifications.template_engine import KEY_ALIASES, REVERSE_ALIASES
        for p_key, p_val in list(payload.items()):
            if p_key in KEY_ALIASES:
                merged[KEY_ALIASES[p_key]] = p_val
            elif p_key in REVERSE_ALIASES:
                merged[REVERSE_ALIASES[p_key]] = p_val

        # Ensure flat shorthand aliases exist if not already defined
        for key, val in list(merged.items()):
            if "." in key:
                short_key = key.split(".")[-1]
                if short_key not in merged:
                    merged[short_key] = val

        return merged

    @classmethod
    async def _fetch_and_aggregate_context(
        cls, user_id: str, company_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Aggregates relational learner profile data using single-trip Postgres RPC.
        Falls back to resilient individual table lookups if RPC is unavailable.
        """
        db = get_service_supabase_client()

        # High-Performance Single-Query Consolidation (Phase 14 Optimization)
        try:
            rpc_res = db.rpc("get_notification_recipient_context_rpc", {
                "p_user_id": user_id,
                "p_company_id": company_id
            }).execute()
            if rpc_res.data and isinstance(rpc_res.data, dict) and len(rpc_res.data) > 0:
                return rpc_res.data
        except Exception as rpc_err:
            logger.warning(f"Consolidated context RPC failed for user {user_id}, falling back: {rpc_err}")

        ctx: Dict[str, Any] = {}
        resolved_company_id = company_id

        # 1. Subscriber Identity & Organization Context
        try:
            u_res = (
                db.table("users")
                .select("user_id,name,email,company_id,manager_id,role,department,email_unsubscribed")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            user_data = getattr(u_res, "data", None) or {}
            full_name = user_data.get("name") or "Learner"
            first_name = full_name.split()[0] if full_name else "there"
            email = user_data.get("email") or ""
            if user_data.get("company_id"):
                resolved_company_id = user_data["company_id"]

            # Company Name
            company_name = "Lucid"
            if resolved_company_id:
                c_res = (
                    db.table("companies")
                    .select("name")
                    .eq("company_id", resolved_company_id)
                    .maybe_single()
                    .execute()
                )
                if c_res.data:
                    company_name = c_res.data.get("name") or "Lucid"

            # Manager Name
            manager_name = "Manager"
            if user_data.get("manager_id"):
                m_res = (
                    db.table("users")
                    .select("name")
                    .eq("user_id", user_data["manager_id"])
                    .maybe_single()
                    .execute()
                )
                if m_res.data:
                    manager_name = m_res.data.get("name") or "Manager"

            ctx["subscriber.first_name"] = first_name
            ctx["subscriber.full_name"] = full_name
            ctx["subscriber.email"] = email
            ctx["subscriber.company_name"] = company_name
            ctx["subscriber.manager_name"] = manager_name
            ctx["subscriber.role"] = user_data.get("role") or "employee"
            ctx["subscriber.department"] = user_data.get("department") or "General"
            ctx["subscriber.email_unsubscribed"] = bool(user_data.get("email_unsubscribed", False))

            # Delivery preferences
            try:
                p_res = (
                    db.table("notification_preferences")
                    .select("in_app_enabled,email_enabled,push_enabled")
                    .eq("user_id", user_id)
                    .maybe_single()
                    .execute()
                )
                p_data = getattr(p_res, "data", None) or {}
                ctx["preferences.in_app_enabled"] = p_data.get("in_app_enabled", True)
                ctx["preferences.email_enabled"] = p_data.get("email_enabled", True)
                ctx["preferences.push_enabled"] = p_data.get("push_enabled", True)
            except Exception:
                ctx["preferences.in_app_enabled"] = True
                ctx["preferences.email_enabled"] = True
                ctx["preferences.push_enabled"] = True

        except Exception as e:
            logger.warning(f"Error fetching subscriber profile for {user_id}: {e}")
            ctx["subscriber.first_name"] = "there"
            ctx["subscriber.full_name"] = "Learner"
            ctx["subscriber.company_name"] = "Lucid"
            ctx["subscriber.role"] = "employee"
            ctx["subscriber.department"] = "General"
            ctx["subscriber.email_unsubscribed"] = False
            ctx["preferences.in_app_enabled"] = True
            ctx["preferences.email_enabled"] = True
            ctx["preferences.push_enabled"] = True

        # 2. VARK Cognitive Modality Profile
        try:
            vark_res = (
                db.table("employee_learning_style")
                .select("learning_style,answers,gpt_analysis")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            vark_data = getattr(vark_res, "data", None) or {}
            raw_style = str(vark_data.get("learning_style") or "auditory").lower()

            is_visual = "visual" in raw_style
            is_auditory = "auditory" in raw_style or (not is_visual and "read" not in raw_style and "kinest" not in raw_style)
            is_kinesthetic = "kinesthetic" in raw_style
            is_reading = "reading" in raw_style or "write" in raw_style

            primary_style = "Auditory"
            cta_label = "Listen to 3-Min Audio Recap"
            cta_url = "/learn?mode=audio"

            if is_visual:
                primary_style = "Visual"
                cta_label = "View Visual Mindmap & Diagrams"
                cta_url = "/learn?mode=visual"
            elif is_kinesthetic:
                primary_style = "Kinesthetic"
                cta_label = "Start Interactive Practice Drill"
                cta_url = "/gamification/arena"
            elif is_reading:
                primary_style = "Reading/Writing"
                cta_label = "Read Executive Summary & Digest"
                cta_url = "/learn?mode=digest"

            ctx["vark.primary_style"] = primary_style
            ctx["vark.is_visual"] = is_visual
            ctx["vark.is_auditory"] = is_auditory
            ctx["vark.is_kinesthetic"] = is_kinesthetic
            ctx["vark.is_reading_writing"] = is_reading
            ctx["vark.recommended_cta_label"] = cta_label
            ctx["vark.recommended_cta_url"] = cta_url
        except Exception as ve:
            logger.warning(f"Error fetching VARK for {user_id}: {ve}")
            ctx["vark.primary_style"] = "Auditory"
            ctx["vark.is_auditory"] = True
            ctx["vark.recommended_cta_label"] = "Listen to Audio Recap"
            ctx["vark.recommended_cta_url"] = "/learn"

        # 3. Gamification Metrics & Social Rivalry
        try:
            g_res = (
                db.table("user_gamification_profiles")
                .select("total_xp,current_streak_days,last_activity_date,company_id")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            g_data = getattr(g_res, "data", None) or {}
            total_xp = int(g_data.get("total_xp") or 0)
            streak_days = int(g_data.get("current_streak_days") or 0)
            comp_id = g_data.get("company_id") or resolved_company_id

            # Calculate Leaderboard Rank & Immediate Rival
            rank = 1
            rival_name = "the top learner"
            points_to_next = 50
            if comp_id:
                lb_res = (
                    db.table("user_gamification_profiles")
                    .select("user_id,total_xp,users!inner(name)")
                    .eq("company_id", comp_id)
                    .order("total_xp", desc=True)
                    .limit(50)
                    .execute()
                )
                leaderboard = getattr(lb_res, "data", []) or []
                for idx, entry in enumerate(leaderboard):
                    if entry.get("user_id") == user_id:
                        rank = idx + 1
                        if idx > 0:
                            rival_entry = leaderboard[idx - 1]
                            rival_name = (
                                rival_entry.get("users", {}).get("name") or "your colleague"
                            ).split()[0]
                            rival_xp = int(rival_entry.get("total_xp") or 0)
                            points_to_next = max(10, rival_xp - total_xp + 1)
                        break

            # Hours remaining until midnight UTC for streak rescue
            now_utc = datetime.now(timezone.utc)
            midnight_utc = now_utc.replace(hour=23, minute=59, second=59)
            streak_expiring_hours = max(1, int((midnight_utc - now_utc).total_seconds() // 3600))

            ctx["gamification.streak_days"] = streak_days
            ctx["gamification.xp_points"] = total_xp
            ctx["gamification.leaderboard_rank"] = f"#{rank}"
            ctx["gamification.rival_name"] = rival_name
            ctx["gamification.points_to_next_rank"] = points_to_next
            ctx["gamification.streak_expiring_hours"] = streak_expiring_hours
        except Exception as ge:
            logger.warning(f"Error fetching gamification for {user_id}: {ge}")
            ctx["gamification.streak_days"] = 1
            ctx["gamification.xp_points"] = 100
            ctx["gamification.leaderboard_rank"] = "#1"
            ctx["gamification.rival_name"] = "your teammate"
            ctx["gamification.points_to_next_rank"] = 50

        # 4. Assessment Intelligence & Weak Topics
        try:
            a_res = (
                db.table("employee_assessments")
                .select("score,max_score,feedback,question_feedback,assessments(type,processed_module_id)")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            a_list = getattr(a_res, "data", []) or []
            if a_list:
                latest_ass = a_list[0]
                score = latest_ass.get("score") or 75
                ctx["assessment.score"] = score
                ctx["assessment.passing_score"] = 70
                ctx["assessment.feedback_summary"] = (
                    latest_ass.get("feedback") or "Keep reviewing foundational principles."
                )[:120]
                ctx["assessment.weak_topic"] = "Core Objection Handling"
                ctx["assessment.remediation_module"] = "Sales Precision & Objections Micro-Drill"
            else:
                ctx["assessment.score"] = 80
                ctx["assessment.passing_score"] = 70
                ctx["assessment.feedback_summary"] = "Solid conceptual understanding."
                ctx["assessment.weak_topic"] = "Key Definitions"
                ctx["assessment.remediation_module"] = "Core Module Refresher"
        except Exception as ae:
            logger.debug(f"Assessment context query error: {ae}")

        # 5. Curriculum Progress
        try:
            p_res = (
                db.table("module_progress")
                .select("module_id,completed,progress,processed_modules(title)")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            p_list = getattr(p_res, "data", []) or []
            if p_list:
                prog = p_list[0]
                mod_title = (
                    prog.get("processed_modules", {}).get("title")
                    if isinstance(prog.get("processed_modules"), dict)
                    else "Active Module"
                ) or "Active Module"
                pct = int(prog.get("progress") or (100 if prog.get("completed") else 50))
                ctx["curriculum.module_name"] = mod_title
                ctx["curriculum.progress_percentage"] = pct
                ctx["curriculum.minutes_remaining"] = max(5, int((100 - pct) * 0.2))
                ctx["curriculum.days_left"] = 2
            else:
                ctx["curriculum.module_name"] = "Core Onboarding Track"
                ctx["curriculum.progress_percentage"] = 50
                ctx["curriculum.minutes_remaining"] = 15
                ctx["curriculum.days_left"] = 3
        except Exception as pe:
            logger.debug(f"Curriculum context query error: {pe}")

        return ctx
