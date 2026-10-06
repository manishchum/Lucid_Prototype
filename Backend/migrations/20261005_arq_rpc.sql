-- RPC function to atomically fetch and lock pending notification jobs
CREATE OR REPLACE FUNCTION get_and_lock_notification_jobs(p_limit INT DEFAULT 50)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    company_id UUID,
    notification_type VARCHAR,
    metadata JSONB,
    attempts INT,
    max_attempts INT
) AS $$
BEGIN
    RETURN QUERY
    WITH selected AS (
        SELECT nj.id
        FROM notification_jobs nj
        WHERE nj.status IN ('PENDING', 'QUEUED')
          AND nj.scheduled_at <= NOW()
        ORDER BY nj.scheduled_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_jobs u
    SET status = 'PROCESSING',
        locked_at = NOW(),
        attempts = u.attempts + 1
    FROM selected
    WHERE u.id = selected.id
    RETURNING u.id, u.user_id, u.company_id, u.notification_type, u.metadata, u.attempts, u.max_attempts;
END;
$$ LANGUAGE plpgsql;
