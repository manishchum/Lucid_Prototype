# Database Migration - Apply This First!

## ⚠️ IMPORTANT: You MUST apply this migration for the unsubscribe system to work!

If you get this error when clicking unsubscribe:
```
"Unknown column 'email_unsubscribed' in field list"
```

You need to apply this migration to your Supabase database.

## How to Apply

1. Go to Supabase Dashboard: https://app.supabase.com
2. Select your project "lucid" (fmkikkebrxyzjsffqgex)
3. Click "SQL Editor" in the left sidebar
4. Click "New Query"
5. Paste the SQL below
6. Click "Run"
7. You should see: "Query successful"

## The Migration SQL

```sql
-- Step 1: Add email_unsubscribed column
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email_unsubscribed boolean NOT NULL DEFAULT false;

-- Step 2: Add unsubscribed_at column
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS unsubscribed_at timestamp with time zone NULL;

-- Step 3: Create index for fast lookups of subscribed users
CREATE INDEX IF NOT EXISTS idx_users_email_unsubscribed 
ON public.users USING btree (email_unsubscribed) 
WHERE email_unsubscribed = false;

-- Step 4: Create index for unsubscribed_at timestamps
CREATE INDEX IF NOT EXISTS idx_users_unsubscribed_at
ON public.users USING btree (unsubscribed_at DESC NULLS LAST)
WHERE email_unsubscribed = true;

-- Step 5: Create composite index for bulk sends
CREATE INDEX IF NOT EXISTS idx_users_company_subscribed
ON public.users USING btree (company_id, email_unsubscribed, is_active)
WHERE email_unsubscribed = false AND is_active = true;

-- Step 6: Add helpful comments
COMMENT ON COLUMN public.users.email_unsubscribed IS 'GDPR/CAN-SPAM compliance flag. When true, user has opted out of all email communications. Set by clicking unsubscribe link in emails.';

COMMENT ON COLUMN public.users.unsubscribed_at IS 'Timestamp when user unsubscribed from emails. NULL when user is subscribed.';
```

## Verify It Worked

After running the migration, verify the columns exist:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users' AND column_name IN ('email_unsubscribed', 'unsubscribed_at');
```

You should see:
```
column_name          | data_type                | is_nullable
---------------------|-------------------------|------------
email_unsubscribed   | boolean                 | NO
unsubscribed_at      | timestamp with time zone| YES
```

## What These Columns Do

### email_unsubscribed
- Type: `boolean`
- Default: `false` (all users start as subscribed)
- Purpose: Flag that indicates if user has unsubscribed
- Set to `true` when user clicks unsubscribe link
- When `true`, user is excluded from email sends

### unsubscribed_at
- Type: `timestamp with time zone`
- Default: `NULL`
- Purpose: Track when user unsubscribed for auditing
- Set to current timestamp when user clicks unsubscribe
- Useful for reporting and GDPR compliance

## After Migration

Once applied, do this:

1. **Restart Backend**:
   ```bash
   cd Backend
   uvicorn main:app --reload
   ```

2. **Clear Frontend cache** (optional):
   ```bash
   rm -rf .next
   npm run dev
   ```

3. **Test the system**:
   - Send an email
   - Click unsubscribe link
   - It should now work!

## Migration File Location

The migration SQL is also available at:
```
Frontend/migrations/add_unsubscribe_columns.sql
```

You can copy from there too if you prefer.

---

**Status**: ⚠️ **REQUIRED** - Must be applied before unsubscribe system will work!
