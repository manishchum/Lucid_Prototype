from typing import Dict, Any
from utils.supabase_client import supabase
import traceback

class GamificationService:
    @staticmethod
    def get_user_streak_multiplier(user_id: str, company_id: str) -> float:
        """
        Fetches the user's current streak from the database and returns a multiplier.
        Base multiplier is 1.0x. Max multiplier is 1.5x.
        """
        try:
            res = supabase.table("user_gamification_profiles") \
                .select("current_streak_days") \
                .eq("user_id", user_id) \
                .eq("company_id", company_id) \
                .limit(1) \
                .execute()
            
            if not res.data:
                return 1.0
                
            streak_days = res.data[0].get("current_streak_days", 0)
            
            # 1.0x base, +0.1x per 3 days, max 1.5x
            multiplier = 1.0 + (streak_days // 3) * 0.1
            return min(multiplier, 1.5)
            
        except Exception as e:
            print(f"[GamificationService] Error fetching streak: {e}")
            return 1.0

    @staticmethod
    def calculate_earned_xp(base_xp: int, wrong_attempts: int, streak_multiplier: float) -> int:
        """
        Calculates final XP based on base XP, penalties for wrong attempts, and streak multiplier.
        Floor limit is 50 XP.
        """
        penalty = wrong_attempts * 25
        xp_after_penalty = max(base_xp - penalty, 50)
        
        final_xp = int(xp_after_penalty * streak_multiplier)
        return final_xp
