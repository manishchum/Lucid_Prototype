# Role-Play Database Storage Setup

## Overview
The role-play system now automatically saves all conversations and assessments to Supabase database.

## Database Tables

### 1. `roleplay_sessions`
Stores complete conversation transcripts and metadata.

**Columns:**
- `id` - UUID primary key
- `employee_id` - UUID (Firebase Auth UID)
- `module_id` - UUID (optional - links to training module)
- `scenario_id` - Text (scenario identifier)
- `scenario_title` - Text (e.g., "Sales Pitch for New Software")
- `scenario_role` - Text (e.g., "Skeptical CTO")
- `scenario_difficulty` - Text ("Easy", "Medium", "Hard")
- `conversation_transcript` - JSONB (array of messages)
- `started_at` - Timestamp
- `completed_at` - Timestamp (null if not completed)
- `duration_seconds` - Integer
- `message_count` - Integer
- `created_at` / `updated_at` - Timestamps

### 2. `roleplay_assessments`
Stores AI-generated performance reports.

**Columns:**
- `id` - UUID primary key
- `session_id` - UUID (foreign key to roleplay_sessions)
- `employee_id` - UUID (Firebase Auth UID)
- `overall_score` - Integer (0-100)
- `summary` - Text
- `parameters` - JSONB (array of {name, score, feedback})
- `recommendations` - JSONB (array of strings)
- `created_at` / `updated_at` - Timestamps

## Setup Instructions

### Step 1: Run Migration

1. Open Supabase SQL Editor
2. Copy the contents of `/migrations/20260115_add_roleplay_sessions.sql`
3. Execute the SQL to create tables and policies

### Step 2: Verify Tables Created

```sql
-- Check tables exist
SELECT tablename FROM pg_catalog.pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE 'roleplay%';

-- Should return:
-- roleplay_sessions
-- roleplay_assessments
```

### Step 3: Test Permissions

The tables use Row Level Security (RLS):
- Employees can only see/create their own data
- Each row is tied to `employee_id` (Firebase Auth UID)

## How It Works

### Automatic Saving

**When conversation starts:**
```typescript
1. User clicks "Start Conversation"
2. createRolePlaySession() creates DB record
3. Returns session_id for tracking
```

**During conversation:**
```typescript
1. Each message exchange is auto-saved
2. updateRolePlaySession() updates transcript
3. No user action required
```

**When conversation ends:**
```typescript
1. User clicks "End Session"
2. Session marked as completed
3. Assessment generated via Gemini API
4. createRolePlayAssessment() saves report
5. Assessment linked to session via session_id
```

## Database Helper Functions

Located in `/lib/roleplayDatabase.ts`:

### Creating a Session
```typescript
const { data, error } = await createRolePlaySession(
  employeeId,      // Firebase Auth UID
  scenarioId,      // "sales-pitch" 
  scenarioTitle,   // "Sales Pitch for New Software"
  scenarioRole,    // "Skeptical CTO"
  difficulty,      // "Easy"
  moduleId         // Optional module link
);
```

### Updating Session (Auto-saves)
```typescript
await updateRolePlaySession(
  sessionId,
  messages,        // Array of Message objects
  isCompleted      // true when ending session
);
```

### Creating Assessment
```typescript
await createRolePlayAssessment(
  sessionId,
  employeeId,
  {
    overallScore: 85,
    summary: "...",
    parameters: [...],
    recommendations: [...]
  }
);
```

### Retrieving Data
```typescript
// Get employee's recent sessions
const { data } = await getEmployeeRolePlaySessions(employeeId, 10);

// Get specific session with assessment
const { data } = await getRolePlaySessionWithAssessment(sessionId);

// Get statistics
const { data } = await getEmployeeRolePlayStats(employeeId);
// Returns: { total_sessions, average_score, best_score, etc. }
```

## Data Flow

```
User Action                  → Database Operation
────────────────────────────────────────────────
Click "Start"                → INSERT roleplay_sessions
Speak/AI Responds            → UPDATE conversation_transcript
Click "End Session"          → UPDATE completed_at
Assessment Generated         → INSERT roleplay_assessments
```

## Query Examples

### Get Employee's Best Scores
```sql
SELECT 
  rs.scenario_title,
  ra.overall_score,
  ra.summary,
  rs.completed_at
FROM roleplay_sessions rs
JOIN roleplay_assessments ra ON rs.id = ra.session_id
WHERE rs.employee_id = 'user-uuid-here'
ORDER BY ra.overall_score DESC
LIMIT 5;
```

### Track Progress Over Time
```sql
SELECT 
  DATE(rs.completed_at) as practice_date,
  AVG(ra.overall_score) as avg_score,
  COUNT(*) as sessions_count
FROM roleplay_sessions rs
JOIN roleplay_assessments ra ON rs.id = ra.session_id
WHERE rs.employee_id = 'user-uuid-here'
  AND rs.completed_at IS NOT NULL
GROUP BY DATE(rs.completed_at)
ORDER BY practice_date DESC;
```

### Find Common Weaknesses
```sql
SELECT 
  param->>'name' as skill,
  AVG((param->>'score')::int) as avg_score
FROM roleplay_assessments ra,
     jsonb_array_elements(ra.parameters) as param
WHERE ra.employee_id = 'user-uuid-here'
GROUP BY param->>'name'
ORDER BY avg_score ASC;
```

## Console Logs to Watch

When testing, you'll see:
```
Session created with ID: abc-123...
Messages auto-saved to database
Session marked as completed in database
Assessment saved to database
```

## Troubleshooting

**Issue**: "Error creating session"
- Check Supabase connection
- Verify RLS policies allow INSERT
- Confirm user is authenticated (user.uid exists)

**Issue**: "Error saving assessment"
- Check session_id is valid
- Verify assessment format matches schema
- Check JSONB fields are properly formatted

**Issue**: Can't query own data
- RLS uses auth.uid() - ensure user is logged in via Firebase
- Check employee_id matches Firebase Auth UID

## Benefits

✅ **Automatic saving** - No manual "save" buttons
✅ **Progress tracking** - See improvement over time
✅ **Detailed analytics** - Query by scenario, score, date
✅ **Recovery** - Sessions saved even if browser closes
✅ **Admin insights** - Identify training needs across team
✅ **Audit trail** - Complete conversation history

## Future Enhancements

- [ ] Resume incomplete sessions
- [ ] Compare performance across scenarios
- [ ] Team leaderboards
- [ ] Export transcripts to PDF
- [ ] Manager dashboard for team analytics
