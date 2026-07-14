-- Migration: Add email unsubscribe support to users table
-- Description: Adds email_unsubscribed and unsubscribed_at columns to track user unsubscribe status
-- Date: 2026-03-21

-- Add email_unsubscribed column
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email_unsubscribed boolean DEFAULT false;

-- Add unsubscribed_at column to track when user unsubscribed
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS unsubscribed_at timestamp with time zone DEFAULT NULL;

-- Create index for efficient filtering when sending bulk emails
-- This allows quick queries like: SELECT * FROM users WHERE email_unsubscribed = false
CREATE INDEX IF NOT EXISTS idx_users_email_unsubscribed
ON public.users(email_unsubscribed)
WHERE email_unsubscribed = true;

-- Create index for finding unsubscribed users by date (for analytics/reporting)
CREATE INDEX IF NOT EXISTS idx_users_unsubscribed_at
ON public.users(unsubscribed_at DESC NULLS LAST)
WHERE email_unsubscribed = true;

-- Add comment for documentation
COMMENT ON COLUMN public.users.email_unsubscribed IS 'Whether the user has unsubscribed from email notifications (GDPR/CAN-SPAM compliance)';
COMMENT ON COLUMN public.users.unsubscribed_at IS 'Timestamp when the user unsubscribed from email notifications';
