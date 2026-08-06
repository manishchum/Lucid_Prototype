"""
Database operations for leaderboard functionality.
Handles leaderboard calculations, rankings, and user statistics.
"""

from typing import Dict, Any, Optional, List
from ..supabase_client import supabase
from .permissions import check_company_access


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


async def get_user_total_points(user_id: str, company_id: str) -> int:
    """
    Calculate total points earned by a user in a company.
    Points are awarded for completed learning plans.
    """
    try:
        # Get all learning plans for this user
        all_plans_resp = supabase.table('learning_plan').select(
            'learning_plan_id, module_id, processed_module_ids, overall_status, status, completed_at'
        ).eq('user_id', user_id).execute()
        
        # Get progress records for quiz completion check
        progress_resp = supabase.table('module_progress').select(
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
        
        modules_resp = supabase.table('training_modules').select(
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
    limit: int = 50
) -> Dict[str, Any]:
    """
    Get leaderboard for a company, ranking users by completion percentage.
    """
    try:
        # Get all active users in the company
        users_resp = supabase.table('users').select(
            'user_id, name, avatar_url, email'
        ).eq('company_id', company_id).eq('is_active', True).execute()
        
        if not users_resp.data:
            return {"data": [], "error": None}
        
        company_user_ids = [u['user_id'] for u in users_resp.data]
        
        # Get all learning plans for these users
        all_plans_resp = supabase.table('learning_plan').select(
            'user_id, learning_plan_id, module_id, processed_module_ids, overall_status, status, completed_at, baseline_assessment'
        ).in_('user_id', company_user_ids).execute()

        # Get all completed module progress for these users
        all_progress_resp = supabase.table('module_progress').select(
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
        
        return {"data": ranked_leaderboard[:limit], "error": None}
    except Exception as e:
        import traceback
        print(f"[leaderboard_db] get_company_leaderboard: CRITICAL ERROR: {e}")
        traceback.print_exc()
        return {"data": None, "error": str(e)}


async def get_user_rank(
    user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Get a specific user's rank and percentile in their company's leaderboard.
    
    Returns:
    - rank: User's position (1 = top)
    - total_points: User's total points
    - modules_completed: Count of completed modules
    - percentile: User's percentile (0-100) where 100 is top
    - total_users: Total users in company
    - users_ahead: Number of users with more points
    """
    try:
        # Verify user belongs to the company
        user_resp = supabase.table('users').select(
            'user_id, name, avatar_url, email, company_id'
        ).eq('user_id', user_id).single().execute()
        
        if not user_resp.data:
            return {"data": None, "error": "User not found"}
        
        user_company = user_resp.data.get('company_id')
        if user_company != company_id:
            return {"data": None, "error": "User does not belong to this company"}
        
        # Get user's points
        user_points = await get_user_total_points(user_id, company_id)
        
        # Get user's completed modules count
        plans_resp = supabase.table('learning_plan').select(
            'learning_plan_id'
        ).eq('user_id', user_id).eq('overall_status', True).execute()
        
        modules_completed = len(plans_resp.data) if plans_resp.data else 0
        
        # Get full leaderboard for the company to calculate rank
        leaderboard_resp = await get_company_leaderboard(company_id, limit=10000)
        
        if leaderboard_resp["error"]:
            return {"data": None, "error": leaderboard_resp["error"]}
        
        leaderboard = leaderboard_resp.get("data", [])
        
        if not leaderboard:
            return {"data": None, "error": "Could not calculate rank"}
        
        # Find user's rank in leaderboard
        user_rank = None
        for entry in leaderboard:
            if entry['user_id'] == user_id:
                user_rank = entry['rank']
                break
        
        if user_rank is None:
            # User not in leaderboard (no points yet), find their position
            user_rank = len(leaderboard) + 1
        
        # Calculate percentile (100 = top, 0 = bottom)
        total_users = len(leaderboard)
        users_ahead = user_rank - 1
        
        if total_users > 1:
            percentile = int((total_users - user_rank) / (total_users - 1) * 100)
        else:
            percentile = 100
        
        return {
            "data": {
                'user_id': user_id,
                'name': user_resp.data.get('name'),
                'avatar_url': user_resp.data.get('avatar_url'),
                'rank': user_rank,
                'total_points': user_points,
                'modules_completed': modules_completed,
                'percentile': percentile,
                'total_users': total_users,
                'users_ahead': users_ahead
            },
            "error": None
        }
    except Exception as e:
        return {"data": None, "error": str(e)}


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
    limit: int = 10
) -> Dict[str, Any]:
    """
    Get top performers in a company (convenience function with default limit).
    """
    return await get_company_leaderboard(company_id, limit=limit)


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
        # Get top performers
        top_resp = await get_company_leaderboard(company_id, limit=top_limit)
        if top_resp["error"]:
            return {"data": None, "error": top_resp["error"]}
        
        top_performers = top_resp.get("data", [])
        
        # Check if requesting user is in top performers
        user_in_top = any(u['user_id'] == requesting_user_id for u in top_performers)
        
        user_rank_info = None
        if not user_in_top:
            # Get user's rank info
            rank_resp = await get_user_rank(requesting_user_id, company_id)
            if not rank_resp["error"]:
                user_rank_info = rank_resp.get("data")
        
        # Get total users count
        total_users_resp = supabase.table('users').select(
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
