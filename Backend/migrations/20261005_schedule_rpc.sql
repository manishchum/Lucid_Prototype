-- RPC to schedule notification jobs, automatically inferring the user's company and handling idempotency silently
CREATE OR REPLACE FUNCTION schedule_notification_job_rpc(
    p_user_id UUID,
    p_notification_type VARCHAR,
    p_metadata JSONB,
    p_assignment_id UUID DEFAULT NULL,
    p_scheduled_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_company_id UUID;
    v_idempotency_key VARCHAR;
    v_task_id VARCHAR;
    v_sprint_id VARCHAR;
    v_scenario_id VARCHAR;
    v_module_id VARCHAR;
    v_entity_id VARCHAR;
BEGIN
    -- Derive company_id from user
    SELECT company_id INTO v_company_id FROM users WHERE user_id = p_user_id LIMIT 1;
    
    IF p_scheduled_at IS NULL THEN
        p_scheduled_at := NOW();
    END IF;
    
    -- Extract IDs from metadata if available for idempotency
    v_task_id := p_metadata->>'task_id';
    v_sprint_id := p_metadata->>'sprint_id';
    v_scenario_id := p_metadata->>'scenario_id';
    v_module_id := p_metadata->>'module_id';
    
    v_entity_id := COALESCE(v_task_id, v_sprint_id, v_scenario_id, v_module_id, (EXTRACT(EPOCH FROM NOW())::int)::text);
    
    v_idempotency_key := p_user_id::text || ':' || p_notification_type || ':' || v_entity_id;

    BEGIN
        INSERT INTO notification_jobs (
            company_id, user_id, assignment_id, notification_type, scheduled_at, idempotency_key, metadata
        ) VALUES (
            v_company_id, p_user_id, p_assignment_id, p_notification_type, p_scheduled_at, v_idempotency_key, p_metadata
        );
        RETURN TRUE;
    EXCEPTION WHEN unique_violation THEN
        -- Safely ignore duplicate scheduling
        RETURN TRUE;
    END;
END;
$$ LANGUAGE plpgsql;
