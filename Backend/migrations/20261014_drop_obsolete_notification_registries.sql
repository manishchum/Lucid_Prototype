-- Migration: 20261014_drop_obsolete_notification_registries.sql
-- Description: Drops obsolete registry tables (notification_variable_registry and notification_event_presets)
-- that backed the retired developer standalone 'Smart Tags' and 'Notification Triggers' manager tabs.
-- All system variable definitions (31 tokens) and system event presets (11 triggers) are now maintained 
-- as immutable Python contracts in `Backend/utils/notifications/registry_contracts.py`.

BEGIN;

-- 1. Drop obsolete variable registry table
DROP TABLE IF EXISTS public.notification_variable_registry CASCADE;

-- 2. Drop obsolete event presets table
DROP TABLE IF EXISTS public.notification_event_presets CASCADE;

COMMIT;
