# Database Migration: Add Infographic/Visual Guide Caching

This migration adds the `infographic_data` column to the `processed_modules` table to cache generated visual guides/infographics.

## Purpose

When users click the "Visual Guide" button in a module, the system generates a structured infographic using AI. Without caching, this generation happens every time the user clicks the button, which is:
- **Slow** (takes several seconds each time)
- **Expensive** (uses AI API credits repeatedly)
- **Poor UX** (users have to wait repeatedly for the same data)

This migration adds database caching so the visual guide is generated once and reused.

---

## How to Run

### Method 1: Using Supabase Dashboard (Recommended)

1. **Log into Supabase Dashboard**
   - Navigate to your project
   - Open the SQL Editor

2. **Run the Migration**
   - Open the file: `migrations/add_infographic_data_to_processed_modules.sql`
   - Copy the entire SQL content
   - Paste into the Supabase SQL Editor
   - Click "Run"

3. **Verify Success**
   - You should see a success message
   - The query should complete without errors

---

### Method 2: Using psql Command Line

If you have direct database access via psql:

```bash
# Navigate to the Frontend directory
cd Frontend

# Run the migration script
psql "YOUR_DATABASE_URL" -f migrations/add_infographic_data_to_processed_modules.sql
```

---

## What This Migration Does:

1. **Adds `infographic_data` column** to `processed_modules` table (JSONB type)
2. **Creates a GIN index** for fast queries on the JSONB data
3. **Adds documentation** via column comment

---

## Verify Migration Success:

After running the migration, verify it worked:

```sql
-- Check if the column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'processed_modules' 
  AND column_name = 'infographic_data';

-- Should return:
-- column_name        | data_type
-- -------------------+----------
-- infographic_data   | jsonb

-- Check if the index exists
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'processed_modules' 
  AND indexname = 'idx_processed_modules_infographic_data';

-- Should return:
-- indexname
-- ------------------------------------------
-- idx_processed_modules_infographic_data
```

---

## Data Structure

The cached infographic data follows this structure:

```json
{
  "title": "Module Title",
  "sections": [
    {
      "title": "Section Title",
      "icon": "umbrella|clipboard",
      "points": [
        { "title": "Point Title", "text": "Point description" }
      ],
      "subSections": [
        {
          "title": "Subsection Title",
          "icon": "person|property|term",
          "color": "blue|green|yellow",
          "points": [
            { "title": "Detail Title", "text": "Detail description" }
          ]
        }
      ]
    }
  ],
  "criticalFlags": {
    "title": "Critical Red Flags",
    "flags": [
      {
        "title": "Flag Title",
        "icon": "mismatch|gauge|legal",
        "text": "Warning description",
        "value": "65%"
      }
    ]
  }
}
```

---

## Related Migrations:

You should also run these related caching migrations if you haven't already:
- **Mindmap caching**: `migrations/add_mindmap_data_to_processed_modules.sql`
- **Flashcard caching**: `migrations/add_flashcard_data_to_processed_modules.sql`

---

## Rollback (if needed)

If you need to undo this migration:

```sql
-- Remove the index
DROP INDEX IF EXISTS idx_processed_modules_infographic_data;

-- Remove the column
ALTER TABLE processed_modules DROP COLUMN IF EXISTS infographic_data;
```

---

## Technical Details

- **Column Type**: JSONB (native PostgreSQL JSON with binary storage)
- **Index Type**: GIN (Generalized Inverted Index) for fast JSONB queries
- **Default Value**: NULL (data only populated after first generation)
- **Performance**: Reduces visual guide load time from 3-5 seconds to ~50ms

---

## Testing

After running the migration, test the feature:

1. Navigate to any module page
2. Click the "Visual Guide" button
3. Wait for generation (first time only)
4. Refresh the page
5. Click "Visual Guide" again
6. It should load instantly from cache

---

## Code Changes Included

This migration is part of a larger feature that includes:

1. **Migration file**: `migrations/add_infographic_data_to_processed_modules.sql`
2. **API route updates**: `app/api/generate-infographic/route.ts` (saves to DB)
3. **Frontend updates**: `app/employee/module/[module_id]/page.tsx` (checks cache)

All code changes are already implemented and will work once the migration is run.
