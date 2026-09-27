"""
Database operations for leaderboard functionality.
Handles leaderboard calculations, rankings, and user statistics.
"""

from typing import Dict, Any, Optional, List
from ..supabase_client import supabase, get_user_supabase_client
from .permissions import check_company_access
from utils.redis_client import get_cache, set_cache


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
        import traceback
        traceback.print_exc()
        return 0


async def get_company_leaderboard(
    company_id: str,
    limit: int = 50,
    requesting_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get leaderboard for a company, ranking users by completion percentage.
    Checks Redis first. On cache miss, calls public.get_company_leaderboard_precomputed RPC (<25ms).
    """
    cache_key = f"company_leaderboard:{company_id}"
    cached = get_cache(cache_key)
    if cached:
        return {"data": cached[:limit], "error": None}

    try:
        import asyncio
        from ..auth_bridge import get_service_supabase_client
        service_client = get_service_supabase_client()
        
        # 1. High-Performance SQL RPC (Single roundtrip, <25ms)
        try:
            rpc_res = await asyncio.to_thread(
                lambda: service_client.rpc(
                    "get_company_leaderboard_precomputed",
                    {"p_company_id": company_id}
                ).execute()
            )
            if rpc_res and isinstance(rpc_res.data, list) and len(rpc_res.data) > 0:
                ranked_leaderboard = rpc_res.data
                # Cache full leaderboard in Redis
                set_cache(cache_key, ranked_leaderboard, ttl=600)
                # Cache individual user ranks in Redis in batch
                for entry in ranked_leaderboard:
                    u_id = entry.get("user_id")
                    if u_id:
                        set_cache(f"user_rank:{company_id}:{u_id}", entry, ttl=600)
                return {"data": ranked_leaderboard[:limit], "error": None}
        except Exception as rpc_err:
            print(f"[leaderboard_db] get_company_leaderboard_precomputed RPC fallback: {rpc_err}")

        # 2. Graceful fallback if RPC is not yet deployed
        client = get_user_supabase_client(user_id=requesting_user_id, company_id=company_id) if requesting_user_id else supabase
        # Get all active users in the company
        users_resp = client.table('users').select(
            'user_id, name, avatar_url, email'
        ).eq('company_id', company_id).eq('is_active', True).execute()
        
        if not users_resp.data:
            return {"data": [], "error": None}
        
        company_user_ids = [u['user_id'] for u in users_resp.data]
        
        # Get all learning plans for these users
        all_plans_resp = client.table('learning_plan').select(
            'user_id, learning_plan_id, module_id, processed_module_ids, overall_status, status, completed_at, baseline_assessment'
        ).in_('user_id', company_user_ids).execute()

        # Get all completed module progress for these users
        all_progress_resp = client.table('module_progress').select(
            'user_id, processed_module_id, quiz_score'
        ).in_('user_id', company_user_ids).execute()
        
        # Group plans and progress by user
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
        for user in users_resp.data:
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
                'modules_assigned': total_assigned
            })
        
        leaderboard_data.sort(
            key=lambda x: (x['completion_percentage'], x['modules_completed']),
            reverse=True
        )
        
        # Add rank and limit results
        ranked_leaderboard = []
        for idx, entry in enumerate(leaderboard_data, 1):
            entry['rank'] = idx
            ranked_leaderboard.append(entry)
        
        set_cache(cache_key, ranked_leaderboard, ttl=600)
        return {"data": ranked_leaderboard[:limit], "error": None}
    except Exception as e:
        import traceback
        print(f"[leaderboard_db] get_company_leaderboard: CRITICAL ERROR: {e}")
        traceback.print_exc()
        return {"data": None, "error": str(e)}


async def get_user_rank(
    user_id: str,
    company_id: str,
    requesting_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get a specific user's rank and percentile in their company's leaderboard.
    Optimized with Redis caching and direct resolution from precomputed company leaderboard (<2ms).
    """
    if not user_id or not company_id:
        return {"data": None, "error": "Missing user_id or company_id"}

    cache_key = f"user_rank:{company_id}:{user_id}"
    cached = get_cache(cache_key)
    if cached:
        return {"data": cached, "error": None}

    # Check if company leaderboard is in Redis
    company_cache_key = f"company_leaderboard:{company_id}"
    cached_leaderboard = get_cache(company_cache_key)
    if cached_leaderboard and isinstance(cached_leaderboard, list):
        user_entry = next((e for e in cached_leaderboard if str(e.get('user_id')) == str(user_id)), None)
        if user_entry:
            set_cache(cache_key, user_entry, ttl=600)
            return {"data": user_entry, "error": None}

    try:
        active_user_id = requesting_user_id or user_id
        leaderboard_resp = await get_company_leaderboard(company_id, limit=10000, requesting_user_id=active_user_id)
        if leaderboard_resp.get("error"):
            return {"data": None, "error": leaderboard_resp["error"]}
        
        leaderboard = leaderboard_resp.get("data", []) or []
        user_entry = next((e for e in leaderboard if str(e.get('user_id')) == str(user_id)), None)
        
        if user_entry:
            set_cache(cache_key, user_entry, ttl=600)
            return {"data": user_entry, "error": None}

        total_users = len(leaderboard)
        default_rank = {
            'user_id': user_id,
            'name': None,
            'avatar_url': None,
            'rank': total_users + 1,
            'total_points': 0,
            'modules_completed': 0,
            'percentile': 100,
            'total_users': total_users,
            'users_ahead': total_users
        }
        set_cache(cache_key, default_rank, ttl=300)
        return {"data": default_rank, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def refresh_company_leaderboards() -> Dict[str, Any]:
    """
    Background cron job to precompute leaderboards for all active companies and store in Redis.
    Runs every 5 minutes.
    """
    try:
        import asyncio
        from ..auth_bridge import get_service_supabase_client
        service_client = get_service_supabase_client()
        
        # Get active companies
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
                rpc_res = await asyncio.to_thread(
                    lambda: service_client.rpc(
                        "get_company_leaderboard_precomputed",
                        {"p_company_id": str(c_id)}
                    ).execute()
                )
                if rpc_res and isinstance(rpc_res.data, list) and len(rpc_res.data) > 0:
                    ranked = rpc_res.data
                    set_cache(f"company_leaderboard:{c_id}", ranked, ttl=600)
                    for entry in ranked:
                        u_id = entry.get("user_id")
                        if u_id:
                            set_cache(f"user_rank:{c_id}:{u_id}", entry, ttl=600)
                    refreshed += 1
            except Exception as e:
                print(f"[Cron Leaderboard] Error refreshing company {c_id}: {e}")
        return {"success": True, "refreshed_companies": refreshed}
    except Exception as exc:
        print(f"[Cron Leaderboard] Failed to run cron: {exc}")
        return {"success": False, "error": str(exc)}


async def get_user_rank_simple(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Helper function to get requesting user's rank (permission-aware wrapper).
    Only users can view their own rank, managers can view company-wide leaderboard.
    """
    try:
        # Verify requesting user is in the company
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
    Useful for UI display - show top performers + where user ranks.
    
    Returns:
    - top_performers: List of top N users
    - user_rank_info: Requesting user's rank info (if not in top N)
    - total_users: Total users in company
    """
    try:
        client = get_user_supabase_client(user_id=requesting_user_id, company_id=company_id) if requesting_user_id else supabase
        # Get top performers
        top_resp = await get_company_leaderboard(company_id, limit=top_limit, requesting_user_id=requesting_user_id)
        if top_resp["error"]:
            return {"data": None, "error": top_resp["error"]}
        
        top_performers = top_resp.get("data", [])
        
        # Check if requesting user is in top performers
        user_in_top = any(u['user_id'] == requesting_user_id for u in top_performers)
        
        user_rank_info = None
        if not user_in_top:
            # Get user's rank info
            rank_resp = await get_user_rank(requesting_user_id, company_id, requesting_user_id=requesting_user_id)
            if not rank_resp["error"]:
                user_rank_info = rank_resp.get("data")
        
        # Get total users count
        total_users_resp = client.table('users').select(
            'user_id', count='exact'
        ).eq('company_id', company_id).eq('is_active', True).execute()
        
        total_users = len(total_users_resp.data) if total_users_resp.data else 0
        
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
