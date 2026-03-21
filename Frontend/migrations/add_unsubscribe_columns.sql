-- Unsubscribe Feature Migration
-- Adds email_unsubscribed and unsubscribed_at columns to users table
-- for GDPR/CAN-SPAM compliance tracking

-- Add email_unsubscribed column (default False)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email_unsubscribed boolean NOT NULL DEFAULT false;

-- Add unsubscribed_at timestamp column (nullable, set when user unsubscribes)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS unsubscribed_at timestamp with time zone NULL;

-- Create index on email_unsubscribed for efficient bulk send filtering
-- This allows quick queries like "SELECT * FROM users WHERE email_unsubscribed = false"
CREATE INDEX IF NOT EXISTS idx_users_email_unsubscribed 
ON public.users USING btree (email_unsubscribed) 
WHERE email_unsubscribed = false;

-- Create composite index for unsubscribed_at timestamps
-- Useful for queries like "SELECT * FROM users WHERE email_unsubscribed = true ORDER BY unsubscribed_at DESC"
CREATE INDEX IF NOT EXISTS idx_users_unsubscribed_at
ON public.users USING btree (unsubscribed_at DESC NULLS LAST)
WHERE email_unsubscribed = true;

-- Composite index: get all active, subscribed users by company
-- Used for bulk send operations: "SELECT * FROM users WHERE company_id = ? AND is_active = true AND email_unsubscribed = false"
CREATE INDEX IF NOT EXISTS idx_users_company_subscribed
ON public.users USING btree (company_id, email_unsubscribed, is_active)
WHERE email_unsubscribed = false AND is_active = true;

-- Update existing users to have email_unsubscribed = false (if not already set)
-- This is a safe operation as we're using NOT NULL DEFAULT
-- No UPDATE needed since DEFAULT constraint handles it

-- Add comment to users table explaining the new columns
COMMENT ON COLUMN public.users.email_unsubscribed IS 'GDPR/CAN-SPAM compliance flag. When true, user has opted out of all email communications. Set by clicking unsubscribe link in emails.';

COMMENT ON COLUMN public.users.unsubscribed_at IS 'Timestamp when user unsubscribed from emails. NULL when user is subscribed.';

COMMENT ON INDEX idx_users_email_unsubscribed IS 'Fast lookup of subscribed users for bulk email sends';

COMMENT ON INDEX idx_users_unsubscribed_at IS 'Fast lookup of unsubscribed users by date for auditing';

COMMENT ON INDEX idx_users_company_subscribed IS 'Fast lookup of active, subscribed users within a company for bulk sends';
