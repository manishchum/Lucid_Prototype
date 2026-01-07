# Database Migration: Add Flashcard Caching

This migration adds the `flashcard_data` column to the `processed_modules` table to cache generated flashcards.

## Quick Start - Choose One Method:

### Method 1: Using Supabase Dashboard (Recommended - 2 minutes)

1. **Open Supabase SQL Editor**
   - Go to: https://supabase.com/dashboard
   - Select your project
   - Click **"SQL Editor"** in the left sidebar

2. **Create New Query**
   - Click **"New Query"** button

3. **Copy and Paste SQL**
   - Open the file: `migrations/add_flashcard_data_to_processed_modules.sql`
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
node scripts/run_flashcard_migration.js
```

Note: This method will show you instructions if direct execution isn't available.

---

### Method 3: Using psql Command Line (Advanced)

If you have PostgreSQL client installed:

```bash
# Get your database URL from Supabase Dashboard -> Settings -> Database
# Format: postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres

psql "YOUR_DATABASE_URL" -f migrations/add_flashcard_data_to_processed_modules.sql
```

---

## What This Migration Does:

1. ✅ Adds `flashcard_data` JSONB column to `processed_modules` table
2. ✅ Creates a GIN index for fast JSON queries
3. ✅ Adds documentation comment to the column

## Verify Migration Success:

After running the migration, verify it worked:

1. Go to **Table Editor** in Supabase Dashboard
2. Select `processed_modules` table
3. Check that `flashcard_data` column exists in the columns list

---

## Benefits:

- 🚀 **Faster Loading**: Flashcards load instantly from cache
- 💰 **Cost Savings**: No repeated Gemini API calls for the same flashcards
- 🎯 **Better UX**: Users don't wait for regeneration each time
- ⚡ **Performance**: Reduces server load and API usage

---

## How It Works:

**Before (Without Cache):**
1. User clicks "Flash cards" button
2. System sends content to Gemini API
3. Waits for API response (2-5 seconds)
4. Displays flashcards
5. **Next time**: Repeats steps 2-4 (costs API credits again!)

**After (With Cache):**
1. User clicks "Flash cards" button
2. System checks if flashcards exist in database
3. If cached: Instantly loads from database (0.1 seconds)
4. If not cached: Generates once, saves to database for future use
5. **Next time**: Instantly loads from cache! 🎉

---

## Related Migrations:

You should also run the mindmap caching migration if you haven't already:
- See: `migrations/README_MINDMAP_MIGRATION.md`
- File: `migrations/add_mindmap_data_to_processed_modules.sql`

---

## Troubleshooting:

**Error: "column already exists"**
- This is fine! The migration uses `IF NOT EXISTS` so it's safe to run multiple times.

**Error: "permission denied"**
- Make sure you're using an account with admin/owner permissions in Supabase

**Flashcards still regenerating?**
- Clear your browser cache
- Check the browser console for "[flashcards] Using cached flashcard data" message
- Verify the column exists in the database table

**Still having issues?**
- Contact the development team or check Supabase logs in Dashboard -> Logs
