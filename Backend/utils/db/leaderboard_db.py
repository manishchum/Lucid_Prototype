import asyncio
import json
import traceback
from typing import Dict, Any, Optional, List
from ..supabase_client import supabase, get_user_supabase_client
from .permissions import check_company_access
from utils.redis_client import redis_client, get_cache, set_cache

LEADERBOARD_TTL = 3600  # 1 hour


def _get_zset_key(company_id: str) -> str:
    return f"leaderboard:zset:{company_id}"


def _get_meta_key(company_id: str) -> str:
    return f"leaderboard:meta:{company_id}"


def _calculate_leaderboard_score(completion_percentage: float, modules_completed: int) -> float:
    """
    Computes a composite score where completion_percentage has top priority (0-100),
    and modules_completed breaks ties (0-9999).
    E.g. 85% completion with 12 modules completed = 850012.0
    """
    pct = max(0.0, min(float(completion_percentage or 0), 100.0))
    comp = max(0.0, min(float(modules_completed or 0), 9999.0))
    return (pct * 10000.0) + comp


def is_plan_completed(p: dict, completed_proc_ids: Optional[set] = None) -> bool:
    if not isinstance(p, dict):
        return False
    overall = p.get('overall_status')
    status = str(p.get('status') or '').strip().upper()
    if overall is True or overall == 1 or str(overall).upper() in ('TRUE', '1', 'COMPLETED'):
        return True
    if status in ('COMPLETED', 'PASSED', 'FINISHED'):
        return True
    if p.get('completed_at') is not None:
        return True
    if completed_proc_ids and p.get('processed_module_ids'):
        p_ids = [str(x) for x in p.get('processed_module_ids') if x]
        if p_ids and all(x in completed_proc_ids for x in p_ids):
            return True
    return False

def is_valid_plan(p: dict, completed_proc_ids: Optional[set] = None) -> bool:
    if not isinstance(p, dict):
        return False
    status = str(p.get('status') or '').strip().upper()
    if status in ('DELETED', 'ARCHIVED', 'DISABLED', 'REMOVED'):
        return False
    # If baseline_assessment is True and not completed yet, exclude from active sprints (matches HomeScreen/Web)
    is_baseline = p.get('baseline_assessment') in (True, 1, 'true', '1')
    if is_baseline and not is_plan_completed(p, completed_proc_ids):
        return False
    return True


async def get_user_total_points(user_id: str, company_id: str, requesting_user_id: Optional[str] = None) -> int:
    """
    Calculate total points earned by a user in a company.
    Points are awarded for completed learning plans.
    """
    try:
        active_user_id = requesting_user_id or user_id
        client = get_user_supabase_client(user_id=active_user_id, company_id=company_id) if active_user_id else supabase
        # Get all learning plans for this user
        all_plans_resp = client.table('learning_plan').select(
            'learning_plan_id, module_id, processed_module_ids, overall_status, status, completed_at'
        ).eq('user_id', user_id).execute()
        
        # Get progress records for quiz completion check
        progress_resp = client.table('module_progress').select(
            'processed_module_id, quiz_score'
        ).eq('user_id', user_id).execute()

        completed_proc_ids = set(
            str(pr.get('processed_module_id'))
            for pr in (progress_resp.data or [])
            if pr.get('processed_module_id') and pr.get('quiz_score') is not None
        )
        
        plans = [p for p in (all_plans_resp.data or []) if is_valid_plan(p)]
        completed_plans = [p for p in plans if is_plan_completed(p, completed_proc_ids)]
        
        if not completed_plans:
            return 0
        
        module_ids = [plan.get('module_id') for plan in completed_plans if plan.get('module_id')]
        if not module_ids:
            return 0
        
        modules_resp = client.table('training_modules').select(
            'module_id, points'
        ).in_('module_id', module_ids).execute()
        
        module_points = {m['module_id']: m.get('points', 0) for m in (modules_resp.data or [])}
        total_points = sum(module_points.get(mid, 0) for mid in module_ids)
        
        return total_points
    except Exception as e:
        print(f"[get_user_total_points] Error: {e}")
        traceback.print_exc()
        return 0


async def populate_company_leaderboard_zset(company_id: str) -> List[Dict[str, Any]]:
    """
    On-demand population of Redis Sorted Set (ZSET) and Hash (HSET) for a company.
    Runs SQL RPC get_company_leaderboard_precomputed (<25ms) or fallback and caches in Redis with pipeline.
    """
    if not company_id:
        return []

    ranked_leaderboard: List[Dict[str, Any]] = []
    try:
        from ..auth_bridge import get_service_supabase_client
        service_client = get_service_supabase_client()
        
        # 1. High-Performance SQL RPC (Single roundtrip, <25ms)
        try:
            rpc_res = await asyncio.to_thread(
                lambda: service_client.rpc(
                    "get_company_leaderboard_precomputed",
                    {"p_company_id": str(company_id)}
                ).execute()
            )
            if rpc_res and isinstance(rpc_res.data, list):
                ranked_leaderboard = rpc_res.data
        except Exception as rpc_err:
            print(f"[leaderboard_db] RPC fallback in populate_company_leaderboard_zset: {rpc_err}")
        
        # 2. Python SQL fallback if RPC failed or returned empty unexpectedly
        if not ranked_leaderboard:
            users_resp = await asyncio.to_thread(
                lambda: service_client.table('users').select(
                    'user_id, name, avatar_url, email'
                ).eq('company_id', company_id).eq('is_active', True).execute()
            )
            users_data = users_resp.data or []
            if not users_data:
                return []
            
            company_user_ids = [u['user_id'] for u in users_data]
            all_plans_resp = await asyncio.to_thread(
                lambda: service_client.table('learning_plan').select(
                    'user_id, learning_plan_id, module_id, processed_module_ids, overall_status, status, completed_at, baseline_assessment'
                ).in_('user_id', company_user_ids).execute()
            )
            all_progress_resp = await asyncio.to_thread(
                lambda: service_client.table('module_progress').select(
                    'user_id, processed_module_id, quiz_score'
                ).in_('user_id', company_user_ids).execute()
            )

            user_plans = {}
            for plan in (all_plans_resp.data or []):
                u_id = plan.get('user_id')
                if u_id:
                    user_plans.setdefault(u_id, []).append(plan)

            user_progress = {}
            for pr in (all_progress_resp.data or []):
                u_id = pr.get('user_id')
                if u_id:
                    user_progress.setdefault(u_id, []).append(pr)

            leaderboard_data = []
            for user in users_data:
                u_id = user.get('user_id')
                completed_proc_ids = set(
                    str(pr.get('processed_module_id'))
                    for pr in user_progress.get(u_id, [])
                    if pr.get('processed_module_id') and pr.get('quiz_score') is not None
                )
                plans = [p for p in user_plans.get(u_id, []) if is_valid_plan(p, completed_proc_ids)]
                total_assigned = len(plans)
                total_completed = sum(1 for p in plans if is_plan_completed(p, completed_proc_ids))
                completion_percentage = 0
                if total_assigned > 0:
                    completion_percentage = round((total_completed / total_assigned) * 100)

                leaderboard_data.append({
                    'user_id': u_id,
                    'name': user.get('name', 'Unknown User'),
                    'email': user.get('email'),
                    'avatar_url': user.get('avatar_url'),
                    'completion_percentage': completion_percentage,
                    'modules_completed': total_completed,
                    'modules_assigned': total_assigned,
                    'total_points': total_completed * 100
                })

            leaderboard_data.sort(
                key=lambda x: (x['completion_percentage'], x['modules_completed']),
                reverse=True
            )
            for idx, entry in enumerate(leaderboard_data, 1):
                entry['rank'] = idx
            ranked_leaderboard = leaderboard_data

        # 3. Store into Redis ZSET and HSET via atomic pipeline
        if ranked_leaderboard:
            zset_key = _get_zset_key(company_id)
            meta_key = _get_meta_key(company_id)
            zadd_mapping = {}
            hset_mapping = {}
            for idx, entry in enumerate(ranked_leaderboard, 1):
                uid = str(entry.get('user_id') or '')
                if not uid:
                    continue
                entry['rank'] = idx
                score = _calculate_leaderboard_score(
                    entry.get('completion_percentage', 0),
                    entry.get('modules_completed', 0)
                )
                zadd_mapping[uid] = score
                hset_mapping[uid] = json.dumps(entry)

            pipe = redis_client.pipeline()
            pipe.delete(zset_key, meta_key)
            if zadd_mapping:
                pipe.zadd(zset_key, zadd_mapping)
                pipe.hset(meta_key, mapping=hset_mapping)
                pipe.expire(zset_key, LEADERBOARD_TTL)
                pipe.expire(meta_key, LEADERBOARD_TTL)
            pipe.execute()

        return ranked_leaderboard
    except Exception as e:
        print(f"[leaderboard_db] Error populating ZSET leaderboard for {company_id}: {e}")
        traceback.print_exc()
        return []


async def get_company_leaderboard(
    company_id: str,
    limit: int = 50,
    requesting_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get leaderboard for a company, ranking users by completion percentage and completed modules.
    Powered by Redis Sorted Set (ZSET) for <1ms response time.
    """
    if not company_id:
        return {"data": [], "error": "Missing company_id"}

    zset_key = _get_zset_key(company_id)
    meta_key = _get_meta_key(company_id)

    try:
        # Check if ZSET exists in Redis
        if not redis_client.exists(zset_key):
            await populate_company_leaderboard_zset(company_id)

        # Fetch top N user IDs and composite scores from Redis ZSET (highest score first)
        top_items = redis_client.zrange(zset_key, 0, limit - 1, desc=True, withscores=True)
        if not top_items:
            return {"data": [], "error": None}

        top_uids = [str(item[0]) for item in top_items]
        scores = [float(item[1]) for item in top_items]

        # Fetch metadata in batch via HSET hmget
        raw_metas = redis_client.hmget(meta_key, top_uids)
        ranked_list = []
        for idx, (uid, score, raw) in enumerate(zip(top_uids, scores, raw_metas), 1):
            if raw:
                try:
                    entry = json.loads(raw)
                    if not isinstance(entry, dict):
                        entry = {}
                except Exception:
                    entry = {}
            else:
                entry = {}

            entry["user_id"] = uid
            entry["rank"] = idx

            # Fallback to ZSET composite score if missing or None
            pct_from_score = int(score // 10000.0)
            comp_from_score = int(score % 10000.0)
            if entry.get("completion_percentage") is None:
                entry["completion_percentage"] = pct_from_score
            else:
                try:
                    entry["completion_percentage"] = int(round(float(entry["completion_percentage"])))
                except Exception:
                    entry["completion_percentage"] = pct_from_score

            if entry.get("modules_completed") is None:
                entry["modules_completed"] = comp_from_score
            else:
                try:
                    entry["modules_completed"] = int(entry["modules_completed"])
                except Exception:
                    entry["modules_completed"] = comp_from_score

            if "modules_assigned" not in entry or entry["modules_assigned"] is None:
                entry["modules_assigned"] = entry["modules_completed"]
            entry.setdefault("name", "Unknown User")
            entry.setdefault("total_points", entry["modules_completed"] * 100)
            ranked_list.append(entry)

        return {"data": ranked_list, "error": None}
    except Exception as e:
        print(f"[leaderboard_db] get_company_leaderboard error: {e}")
        traceback.print_exc()
        return {"data": None, "error": str(e)}


async def get_user_rank(
    user_id: str,
    company_id: str,
    requesting_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get a specific user's rank and percentile in their company's leaderboard.
    Powered by Redis ZREVRANK and ZCARD for <1ms response time.
    """
    if not user_id or not company_id:
        return {"data": None, "error": "Missing user_id or company_id"}

    zset_key = _get_zset_key(company_id)
    meta_key = _get_meta_key(company_id)

    try:
        # Ensure ZSET exists
        if not redis_client.exists(zset_key):
            await populate_company_leaderboard_zset(company_id)

        # O(log N) rank lookup
        rank_0 = redis_client.zrevrank(zset_key, str(user_id))
        total_users = redis_client.zcard(zset_key) or 0

        if rank_0 is None:
            # User not in company leaderboard yet
            default_rank = {
                'user_id': user_id,
                'name': None,
                'avatar_url': None,
                'email': None,
                'rank': total_users + 1,
                'total_points': 0,
                'modules_completed': 0,
                'modules_assigned': 0,
                'completion_percentage': 0,
                'percentile': 100,
                'total_users': total_users,
                'users_ahead': total_users
            }
            return {"data": default_rank, "error": None}

        rank = rank_0 + 1
        percentile = round((rank / max(total_users, 1)) * 100)
        score = redis_client.zscore(zset_key, str(user_id)) or 0.0
        pct_from_score = int(score // 10000.0)
        comp_from_score = int(score % 10000.0)

        # Fetch user's metadata from HSET
        raw_meta = redis_client.hget(meta_key, str(user_id))
        user_info = {}
        if raw_meta:
            try:
                user_info = json.loads(raw_meta)
                if not isinstance(user_info, dict):
                    user_info = {}
            except Exception:
                pass

        completion_pct = user_info.get('completion_percentage')
        if completion_pct is None:
            completion_pct = pct_from_score
        else:
            try:
                completion_pct = int(round(float(completion_pct)))
            except Exception:
                completion_pct = pct_from_score

        modules_comp = user_info.get('modules_completed')
        if modules_comp is None:
            modules_comp = comp_from_score
        else:
            try:
                modules_comp = int(modules_comp)
            except Exception:
                modules_comp = comp_from_score

        modules_assigned = user_info.get('modules_assigned')
        if modules_assigned is None:
            modules_assigned = modules_comp
        else:
            try:
                modules_assigned = int(modules_assigned)
            except Exception:
                modules_assigned = modules_comp

        user_rank_data = {
            'user_id': str(user_id),
            'name': user_info.get('name'),
            'email': user_info.get('email'),
            'avatar_url': user_info.get('avatar_url'),
            'rank': rank,
            'completion_percentage': completion_pct,
            'modules_completed': modules_comp,
            'modules_assigned': modules_assigned,
            'total_points': user_info.get('total_points', modules_comp * 100),
            'percentile': percentile,
            'total_users': total_users,
            'users_ahead': rank_0
        }
        return {"data": user_rank_data, "error": None}
    except Exception as e:
        print(f"[leaderboard_db] get_user_rank error: {e}")
        return {"data": None, "error": str(e)}


def update_user_leaderboard_score(
    company_id: str,
    user_id: str,
    completion_percentage: float,
    modules_completed: int,
    user_meta: Optional[Dict[str, Any]] = None
):
    """
    Instantly updates a single user's score in the Redis ZSET and metadata in HSET.
    Ensures real-time rank updates when a module or assessment is completed.
    """
    if not company_id or not user_id:
        return
    try:
        zset_key = _get_zset_key(company_id)
        meta_key = _get_meta_key(company_id)

        # If ZSET does not exist yet, it will lazily build on next read
        if not redis_client.exists(zset_key):
            return

        score = _calculate_leaderboard_score(completion_percentage, modules_completed)
        
        # Merge with existing metadata to prevent field loss
        existing_raw = redis_client.hget(meta_key, str(user_id))
        meta: Dict[str, Any] = {}
        if existing_raw:
            try:
                meta = json.loads(existing_raw)
                if not isinstance(meta, dict):
                    meta = {}
            except Exception:
                meta = {}

        if user_meta and isinstance(user_meta, dict):
            meta.update(user_meta)

        meta['user_id'] = str(user_id)
        meta['completion_percentage'] = int(round(completion_percentage))
        meta['modules_completed'] = int(modules_completed)
        if 'modules_assigned' not in meta:
            meta['modules_assigned'] = int(modules_completed)
        if 'total_points' not in meta:
            meta['total_points'] = int(modules_completed) * 100

        pipe = redis_client.pipeline()
        pipe.zadd(zset_key, {str(user_id): score})
        pipe.hset(meta_key, str(user_id), json.dumps(meta))
        pipe.expire(zset_key, LEADERBOARD_TTL)
        pipe.expire(meta_key, LEADERBOARD_TTL)
        pipe.execute()
    except Exception as e:
        print(f"[leaderboard_db] update_user_leaderboard_score error: {e}")


def invalidate_company_leaderboard(company_id: str):
    """Purges the Redis ZSET and metadata hash for a company."""
    if not company_id:
        return
    try:
        zset_key = _get_zset_key(company_id)
        meta_key = _get_meta_key(company_id)
        redis_client.delete(zset_key, meta_key)
        redis_client.delete(f"company_leaderboard:{company_id}")
    except Exception as e:
        print(f"[leaderboard_db] invalidate_company_leaderboard error for {company_id}: {e}")


async def refresh_company_leaderboards() -> Dict[str, Any]:
    """
    Batch helper to refresh Redis ZSET leaderboards for all active companies.
    Can be invoked manually or triggered by Cloud Scheduler.
    """
    try:
        from ..auth_bridge import get_service_supabase_client
        service_client = get_service_supabase_client()
        
        companies_res = await asyncio.to_thread(
            lambda: service_client.table("companies").select("company_id").execute()
        )
        companies = companies_res.data or []
        refreshed = 0
        for comp in companies:
            c_id = comp.get("company_id")
            if not c_id:
                continue
            try:
                await populate_company_leaderboard_zset(str(c_id))
                refreshed += 1
            except Exception as e:
                print(f"[Leaderboard ZSET] Error refreshing company {c_id}: {e}")
        return {"success": True, "refreshed_companies": refreshed}
    except Exception as exc:
        print(f"[Leaderboard ZSET] Failed to refresh: {exc}")
        return {"success": False, "error": str(exc)}


async def get_user_rank_simple(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Helper function to get requesting user's rank (permission-aware wrapper).
    """
    try:
        has_access = await check_company_access(requesting_user_id, company_id)
        if not has_access:
            return {"data": None, "error": "Permission denied: Not in this company"}
        
        return await get_user_rank(requesting_user_id, company_id)
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_company_leaderboard_top(
    company_id: str,
    limit: int = 10,
    requesting_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get top performers in a company (convenience function with default limit).
    """
    return await get_company_leaderboard(company_id, limit=limit, requesting_user_id=requesting_user_id)


async def get_leaderboard_with_user_highlight(
    requesting_user_id: str,
    company_id: str,
    top_limit: int = 10
) -> Dict[str, Any]:
    """
    Get top leaderboard entries plus requesting user's position if outside top N.
    Ultra-fast execution with 0 database roundtrips using Redis ZSET.
    
    Returns:
    - top_performers: List of top N users
    - user_rank_info: Requesting user's rank info (if not in top N)
    - total_users: Total users in company
    - user_in_top: Whether requesting user is in top N
    """
    try:
        # Get top performers from Redis ZSET
        top_resp = await get_company_leaderboard(company_id, limit=top_limit, requesting_user_id=requesting_user_id)
        if top_resp.get("error"):
            return {"data": None, "error": top_resp["error"]}
        
        top_performers = top_resp.get("data", []) or []
        zset_key = _get_zset_key(company_id)
        total_users = redis_client.zcard(zset_key) or len(top_performers)
        
        # Check if requesting user is in top performers
        user_in_top = any(str(u.get('user_id')) == str(requesting_user_id) for u in top_performers)
        
        user_rank_info = None
        if not user_in_top:
            rank_resp = await get_user_rank(requesting_user_id, company_id, requesting_user_id=requesting_user_id)
            if not rank_resp.get("error"):
                user_rank_info = rank_resp.get("data")
        
        return {
            "data": {
                'top_performers': top_performers,
                'user_rank_info': user_rank_info,
                'total_users': total_users,
                'user_in_top': user_in_top
            },
            "error": None
        }
    except Exception as e:
        return {"data": None, "error": str(e)}
