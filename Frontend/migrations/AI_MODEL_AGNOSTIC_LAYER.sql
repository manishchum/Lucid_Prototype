-- ============================================================
-- AI FEATURES
-- ============================================================

CREATE TABLE ai_features (
    feature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    feature_key TEXT NOT NULL UNIQUE,
    feature_name TEXT NOT NULL,
    description TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_features_key
ON ai_features(feature_key);



-- ============================================================
-- AI MODEL CONFIG
-- ============================================================

CREATE TABLE ai_model_configs (

    config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    feature_id UUID NOT NULL REFERENCES ai_features(feature_id) ON DELETE CASCADE,

    provider TEXT NOT NULL,

    model_name TEXT NOT NULL,

    temperature NUMERIC(3,2),

    top_p NUMERIC(3,2),

    max_tokens INTEGER,

    enabled BOOLEAN DEFAULT TRUE,

    priority INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_model_feature
ON ai_model_configs(feature_id);

CREATE INDEX idx_ai_model_enabled
ON ai_model_configs(enabled);



-- ============================================================
-- AI PROMPTS
-- ============================================================

CREATE TABLE ai_prompts (

    prompt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    feature_id UUID NOT NULL REFERENCES ai_features(feature_id) ON DELETE CASCADE,

    prompt_type TEXT NOT NULL,

    prompt TEXT NOT NULL,

    version INTEGER DEFAULT 1,

    enabled BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_prompt_feature
ON ai_prompts(feature_id);



-- ============================================================
-- AI PROVIDER CONFIG
-- ============================================================

CREATE TABLE ai_provider_config (

    provider_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    provider_name TEXT UNIQUE NOT NULL,

    enabled BOOLEAN DEFAULT TRUE,

    priority INTEGER DEFAULT 1,

    api_env_name TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);



-- ============================================================
-- AI USAGE LOGS
-- ============================================================

CREATE TABLE ai_usage_logs (

    usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id UUID REFERENCES companies(company_id),

    user_id UUID REFERENCES users(user_id),

    feature_id UUID REFERENCES ai_features(feature_id),

    provider TEXT,

    model_name TEXT,

    route TEXT,

    prompt_version INTEGER,

    input_tokens INTEGER DEFAULT 0,

    output_tokens INTEGER DEFAULT 0,

    total_tokens INTEGER DEFAULT 0,

    cost_usd NUMERIC(12,8) DEFAULT 0,

    cost_inr NUMERIC(12,4) DEFAULT 0,

    latency_ms INTEGER,

    status TEXT,

    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_company
ON ai_usage_logs(company_id);

CREATE INDEX idx_ai_usage_feature
ON ai_usage_logs(feature_id);

CREATE INDEX idx_ai_usage_created
ON ai_usage_logs(created_at DESC);






//Execution 2

ALTER TABLE ai_model_configs
ADD COLUMN input_cost_per_million NUMERIC(12,6) DEFAULT 0;

ALTER TABLE ai_model_configs
ADD COLUMN output_cost_per_million NUMERIC(12,6) DEFAULT 0;

//execution 3

ALTER TABLE ai_prompts
ADD COLUMN variables JSONB DEFAULT '[]';

//Execution 4

ALTER TABLE ai_model_configs
ADD COLUMN response_format TEXT DEFAULT 'text';

ALTER TABLE ai_model_configs
ADD COLUMN timeout_seconds INTEGER DEFAULT 120;

ALTER TABLE ai_model_configs
ADD COLUMN max_retries INTEGER DEFAULT 1;