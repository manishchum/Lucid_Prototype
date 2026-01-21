# 🔧 Troubleshooting: Role-Play Reports Not Storing

## Problem
Role-play sessions and assessments are not appearing in the Reports page.

## Root Cause
The database tables `roleplay_sessions` and `roleplay_assessments` don't exist yet in Supabase.

---

## ✅ Solution: Run Database Migration

### Step 1: Check if Tables Exist

Run this command in your terminal:

```bash
cd Frontend
node scripts/check_roleplay_tables.js
```

If you see "Table does NOT exist", proceed to Step 2.

---

### Step 2: Run the Migration in Supabase

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Copy and Paste the Migration**
   - Open file: `/Frontend/migrations/20260115_add_roleplay_sessions.sql`
   - Copy ALL content (115 lines)
   - Paste into Supabase SQL Editor

4. **Run the Migration**
   - Click "Run" button (or press Cmd+Enter)
   - Wait for success message: "Success. No rows returned"

---

### Step 3: Verify Tables Were Created

Run the check script again:

```bash
node scripts/check_roleplay_tables.js
```

You should now see:
```
✅ Table "roleplay_sessions" EXISTS
✅ Table "roleplay_assessments" EXISTS

📊 Database Status:
   - Sessions: 0
   - Assessments: 0
```

---

## 🧪 Test the Complete Flow

1. **Start a Role-Play Session**
   - Go to Employee Dashboard → Role-Play
   - Click "Start Conversation"
   - Have a conversation
   - Click "End Session"

2. **Check Browser Console** (F12 or Cmd+Option+I)
   - You should see:
     ```
     ✅ Session created with ID: <uuid>
     💾 Auto-saving messages...
     ✅ Messages auto-saved to database
     💾 Saving assessment to database...
     ✅ Assessment saved to database successfully
     ```

3. **View in Reports**
   - Go to Reports page
   - Click "🎭 Role-Play Sessions" tab
   - Your session should appear!

---

## 🐛 Debugging

### If you see console errors:

**"relation 'roleplay_sessions' does not exist"**
→ Tables not created. Run migration in Step 2.

**"No user.uid available"**
→ User not logged in. Sign in first.

**"Cannot save assessment - missing sessionId"**
→ Session wasn't created properly. Check console for earlier errors.

### Check Database Manually:

1. Open Supabase Dashboard
2. Go to "Table Editor"
3. Look for tables:
   - `roleplay_sessions`
   - `roleplay_assessments`

---

## 📝 What the Migration Creates

### Tables:
1. **roleplay_sessions** - Stores conversation transcripts
   - Columns: employee_id, scenario details, conversation_transcript (JSONB), timestamps
   
2. **roleplay_assessments** - Stores performance reports
   - Columns: session_id, employee_id, scores, parameters, recommendations

### Security:
- Row Level Security (RLS) enabled
- Users can only see their own data
- Automatic timestamp updates

### Performance:
- 8 indexes for fast queries
- Foreign key constraints
- Cascade delete (deleting session deletes assessment)

---

## ✨ After Migration

Your role-play system will automatically:
- ✅ Create a session when conversation starts
- ✅ Auto-save messages after each exchange
- ✅ Save assessment when session ends
- ✅ Display everything in Reports page

No code changes needed - just run the migration!
