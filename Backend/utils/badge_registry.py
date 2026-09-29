from datetime import datetime
from typing import Dict, Any, List

class BadgeRegistry:
    """
    Centralized configuration for all available Gamification Badges.
    This allows easy addition of new badges, harder milestones, and time-limited/festive badges.
    """
    
    BADGES: List[Dict[str, Any]] = [
        # --- Core Milestone Badges (Permanent) ---
        {
            "badge_key": "badge_1",
            "title": "Main Character 🎯",
            "description": "Complete your 1st drill",
            "icon_symbol": "BookOpen",
            "category": "Drill Milestone",
            "req_drills": 1,
            "req_streak": 0,
            "req_xp": 0
        },
        {
            "badge_key": "badge_2",
            "title": "Locked In 🔒",
            "description": "Complete 10 drills",
            "icon_symbol": "Shield",
            "category": "Drill Milestone",
            "req_drills": 10,
            "req_streak": 0,
            "req_xp": 0
        },
        {
            "badge_key": "badge_3",
            "title": "G.O.A.T. Certified 🏆",
            "description": "Complete 25 drills",
            "icon_symbol": "Trophy",
            "category": "Drill Milestone",
            "req_drills": 25,
            "req_streak": 0,
            "req_xp": 0
        },
        {
            "badge_key": "badge_4",
            "title": "On Fire 🔥",
            "description": "Maintain a 7-day active streak",
            "icon_symbol": "Flame",
            "category": "Streak Milestone",
            "req_drills": 0,
            "req_streak": 7,
            "req_xp": 0
        },
        {
            "badge_key": "badge_5",
            "title": "Unstoppable ⚡",
            "description": "Maintain a 14-day active streak",
            "icon_symbol": "Zap",
            "category": "Streak Milestone",
            "req_drills": 0,
            "req_streak": 14,
            "req_xp": 0
        },
        {
            "badge_key": "badge_6",
            "title": "XP Billionaire 🌟",
            "description": "Reach 5,000+ total earned XP",
            "icon_symbol": "Sparkles",
            "category": "XP Milestone",
            "req_drills": 0,
            "req_streak": 0,
            "req_xp": 5000
        },
        
        # --- Time-Limited / Festive Badges ---
        # Example of a time-limited badge. Users can only earn this between Oct 25 and Nov 5, 2026.
        # {
        #     "badge_key": "halloween_2026",
        #     "title": "Spooky Sprinter 🎃",
        #     "description": "Complete 5 drills during Halloween week",
        #     "icon_symbol": "Ghost",
        #     "category": "Event Milestone",
        #     "req_drills": 5,
        #     "req_streak": 0,
        #     "req_xp": 0,
        #     "available_from": "2026-10-25T00:00:00Z",
        #     "available_until": "2026-11-05T23:59:59Z"
        # }
    ]

    @classmethod
    def get_active_badges(cls) -> List[Dict[str, Any]]:
        """Returns all badges that are currently active and attainable."""
        active_badges = []
        now = datetime.utcnow()
        
        for badge in cls.BADGES:
            is_active = True
            
            # Check availability window if defined
            if "available_from" in badge and badge["available_from"]:
                dt_from = datetime.fromisoformat(badge["available_from"].replace('Z', '+00:00')).replace(tzinfo=None)
                if now < dt_from:
                    is_active = False
                    
            if "available_until" in badge and badge["available_until"]:
                dt_until = datetime.fromisoformat(badge["available_until"].replace('Z', '+00:00')).replace(tzinfo=None)
                if now > dt_until:
                    is_active = False
                    
            if is_active:
                active_badges.append(badge)
                
        return active_badges

    @classmethod
    def evaluate_new_badges(cls, user_profile: Dict[str, Any], unlocked_badge_keys: set) -> List[Dict[str, Any]]:
        """
        Compares the user's current profile stats against active badge requirements.
        Returns a list of badge dictionaries that the user just unlocked.
        """
        new_badges = []
        active_badges = cls.get_active_badges()
        
        drills_count = user_profile.get("drills_completed_count", 0)
        streak = user_profile.get("current_streak_days", 0)
        total_xp = user_profile.get("total_xp", 0)
        
        for badge in active_badges:
            if badge["badge_key"] in unlocked_badge_keys:
                continue # Already unlocked
                
            # Check conditions
            if drills_count >= badge.get("req_drills", 0) and \
               streak >= badge.get("req_streak", 0) and \
               total_xp >= badge.get("req_xp", 0):
                   
                new_badges.append(badge)
                
        return new_badges
