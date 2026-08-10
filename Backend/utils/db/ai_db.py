from utils.supabase_client import supabase


# ============================================================
# FEATURES
# ============================================================

def get_feature(feature_key: str):
    return (
        supabase
        .table("ai_features")
        .select("*")
        .eq("feature_key", feature_key)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )


def list_features():
    return (
        supabase
        .table("ai_features")
        .select("*")
        .eq("is_active", True)
        .order("feature_name")
        .execute()
    )


# ============================================================
# MODEL CONFIG
# ============================================================

def get_model_config(feature_key: str):
    return (
        supabase
        .table("ai_model_configs")
        .select("""
            *,
            ai_features!inner(
                feature_key
            )
        """)
        .eq("ai_features.feature_key", feature_key)
        .eq("enabled", True)
        .order("priority")
        .limit(1)
        .maybe_single()
        .execute()
    )


# ============================================================
# PROMPTS
# ============================================================

def get_prompt(
    feature_key: str,
    prompt_type: str = "default"
):
    feature = get_feature(feature_key)

    if not feature:
        return None

    return (
        supabase
        .table("ai_prompts")
        .select("*")
        .eq("feature_id", feature["feature_id"])
        .eq("prompt_type", prompt_type)
        .eq("enabled", True)
        .order("version", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )


# ============================================================
# PROVIDERS
# ============================================================

def list_enabled_providers():
    return (
        supabase
        .table("ai_provider_config")
        .select("*")
        .eq("enabled", True)
        .order("priority")
        .execute()
    )


# ============================================================
# USAGE
# ============================================================

def insert_usage_log(data: dict):
    return (
        supabase
        .table("ai_usage_logs")
        .insert(data)
        .execute()
    )