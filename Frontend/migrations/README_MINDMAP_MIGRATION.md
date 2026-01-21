# Database Migration: Add Mindmap Caching

This migration adds the `mindmap_data` column to the `processed_modules` table to cache generated mindmaps.

## Quick Start - Choose One Method:

### Method 1: Using Supabase Dashboard (Recommended - 2 minutes)

1. **Open Supabase SQL Editor**
   - Go to: https://supabase.com/dashboard
   - Select your project
   - Click **"SQL Editor"** in the left sidebar

2. **Create New Query**
   - Click **"New Query"** button

3. **Copy and Paste SQL**
   - Open the file: `migrations/add_mindmap_data_to_processed_modules.sql`
   - Copy all the content
   - Paste into the SQL Editor

4. **Execute**
   - Click the **"Run"** button (or press Ctrl+Enter)
   - You should see "Success. No rows returned" message

5. **Done!** ✅

---

### Method 2: Using the Migration Script

```bash
# From the Frontend directory
cd Frontend

# Run the migration script
node scripts/run_mindmap_migration.js
```

Note: This method will show you instructions if direct execution isn't available.

---

### Method 3: Using psql Command Line (Advanced)

If you have PostgreSQL client installed:

```bash
# Get your database URL from Supabase Dashboard -> Settings -> Database
# Format: postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres

psql "YOUR_DATABASE_URL" -f migrations/add_mindmap_data_to_processed_modules.sql
```

---

## What This Migration Does:

1. ✅ Adds `mindmap_data` JSONB column to `processed_modules` table
2. ✅ Creates a GIN index for fast JSON queries
3. ✅ Adds documentation comment to the column

## Verify Migration Success:

After running the migration, verify it worked:

1. Go to **Table Editor** in Supabase Dashboard
2. Select `processed_modules` table
3. Check that `mindmap_data` column exists in the columns list

---

## Benefits:

- 🚀 **Faster Loading**: Mindmaps load instantly from cache
- 💰 **Cost Savings**: No repeated API calls for the same mindmap
- 🎯 **Better UX**: Users don't wait for regeneration

---

## Troubleshooting:

**Error: "column already exists"**
- This is fine! The migration uses `IF NOT EXISTS` so it's safe to run multiple times.

**Error: "permission denied"**
- Make sure you're using an account with admin/owner permissions in Supabase

**Still having issues?**
- Contact the development team or check Supabase logs in Dashboard -> Logs
