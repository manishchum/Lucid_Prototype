# UNSUBSCRIBE SYSTEM - DEPLOYMENT CHECKLIST

## ✅ Pre-Deployment

### Files Created/Modified

```
BACKEND
├── ✅ utils/unsubscribe_token.py       (New) Token generation & verification
├── ✅ utils/email_helper.py            (New) Email helpers & filtering
├── ✅ routes/unsubscribe.py            (New) FastAPI endpoints
├── ✅ test_unsubscribe.py              (New) Test suite
├── ✅ UNSUBSCRIBE_INTEGRATION_EXAMPLE.py (New) Usage examples
└── ✅ main.py                          (Modified) Added router registration

FRONTEND
├── ✅ lib/unsubscribe-token.ts         (Existing) Already working
├── ✅ app/api/unsubscribe/route.ts     (Existing) Already working
├── ✅ app/api/resubscribe/route.ts     (Existing) Already working
├── ✅ app/api/unsubscribe-manual/route.ts (Existing) Already working
├── ✅ app/unsubscribe-success/page.tsx (Existing) Already working
├── ✅ app/unsubscribe-error/page.tsx   (Existing) Already working
└── ✅ migrations/add_unsubscribe_columns.sql (New) Database migration

DOCUMENTATION
├── ✅ UNSUBSCRIBE_IMPLEMENTATION.md      Detailed technical guide
├── ✅ UNSUBSCRIBE_SETUP_SUMMARY.md       Quick reference
└── ✅ DEPLOYMENT_CHECKLIST.md           This file
```

---

## 📋 Deployment Steps (In Order)

### STEP 1: Environment Variables
**Time: 5 minutes**

Add to your `.env` file:

```bash
# Generate a secure random secret (min 32 characters)
# Run this command and copy the output:
# python3 -c "import secrets; print(secrets.token_urlsafe(32))"

UNSUBSCRIBE_SECRET=<paste-your-generated-secret-here>
FRONTEND_URL=https://your-app-domain.com
NEXT_PUBLIC_APP_URL=https://your-app-domain.com
```

**Verify:**
```bash
# Check .env file has UNSUBSCRIBE_SECRET set
grep UNSUBSCRIBE_SECRET .env
```

---

### STEP 2: Database Migration
**Time: 5 minutes**

Apply the migration to add unsubscribe columns:

#### Option A: Supabase Console (Easiest)
1. Go to SQL Editor in Supabase Dashboard
2. Copy entire contents of:
   ```
   Frontend/migrations/add_unsubscribe_columns.sql
   ```
3. Paste into SQL Editor
4. Click "Run" button
5. Wait for completion (should see success message)

#### Option B: Supabase CLI
```bash
# Navigate to project root
cd /Users/monalikagoel/Documents/lucid2074/Lucid_Prototype

# If using Supabase migrations
supabase db push
```

#### Option C: pgAdmin / Direct SQL
If you have direct database access, run:
```sql
-- Copy from Frontend/migrations/add_unsubscribe_columns.sql
-- And execute in your database client
```

**Verify Migration:**
```sql
-- Run in Supabase SQL Editor or database client
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('email_unsubscribed', 'unsubscribed_at');

-- Should return:
-- email_unsubscribed | boolean
-- unsubscribed_at | timestamp with time zone
```

---

### STEP 3: Backend Setup
**Time: 10 minutes**

#### 3a. Verify Import in main.py
```bash
# Check that unsubscribe router is imported and registered
grep -n "unsubscribe" Backend/main.py

# Should show:
# Line with: from routes.unsubscribe import router as unsubscribe_router
# Line with: app.include_router(unsubscribe_router, tags=["unsubscribe"])
```

#### 3b. Test Token Generation
```bash
cd Backend

python3 << 'EOF'
import os

# Must set secret before import
os.environ["UNSUBSCRIBE_SECRET"] = "test_secret_key_at_least_32_characters_long"

from utils.unsubscribe_token import generate_token, verify_token

# Generate token
token = generate_token("test@example.com", "550e8400-e29b-41d4-a716-446655440000")
print(f"✅ Generated token: {token[:50]}...")

# Verify token
payload = verify_token(token)
print(f"✅ Verified payload: {payload}")

# Check expiry
from utils.unsubscribe_token import get_token_expiry_date
expiry = get_token_expiry_date(token)
print(f"✅ Token expires: {expiry}")
EOF
```

**Expected Output:**
```
✅ Generated token: eyJlbWFpbCI6InRlc3RAZXhhbXBs...
✅ Verified payload: {'email': 'test@example.com', 'user_id': '550e8400...', 'issued_at': 1710960000}
✅ Token expires: 2026-04-20 14:00:00
```

---

### STEP 4: API Endpoint Testing
**Time: 10 minutes**

#### 4a. Start Backend Server
```bash
cd Backend
python3 main.py

# Should see:
# INFO:     Application startup complete
# INFO:     Uvicorn running on http://127.0.0.1:8000
```

#### 4b. Test Unsubscribe Endpoints

**Test 1: Generate Token**
```bash
curl -X POST http://localhost:8000/api/unsubscribe/generate-token \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "user_id": "550e8400-e29b-41d4-a716-446655440000"
  }'

# Expected: {"token": "...", "unsubscribe_url": "..."}
```

**Test 2: Unsubscribe with Token**
```bash
# First, get a token from test 1, then use it
curl -X POST http://localhost:8000/api/unsubscribe \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN_HERE"}'

# Expected: {"success": true, "message": "You have been unsubscribed...", "email": "test@example.com"}
```

**Test 3: Manual Unsubscribe (No Token)**
```bash
curl -X POST http://localhost:8000/api/unsubscribe-manual \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Expected: {"success": true, "message": "You have been unsubscribed...", "email": "test@example.com"}
```

**Test 4: Resubscribe**
```bash
curl -X POST http://localhost:8000/api/resubscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Expected: {"success": true, "message": "You have been re-subscribed...", "email": "test@example.com"}
```

---

### STEP 5: Frontend Setup
**Time: 5 minutes**

#### 5a. Verify Token Library
```bash
# Check that unsubscribe token functions are exported
grep -n "export" Frontend/lib/unsubscribe-token.ts | head -10

# Should show:
# export function generateUnsubscribeToken
# export function verifyUnsubscribeToken
# export function buildUnsubscribeUrl
```

#### 5b. Verify API Routes
```bash
# Check frontend API routes exist
ls -la Frontend/app/api/ | grep unsubscribe

# Should show:
# unsubscribe/
# resubscribe/
# unsubscribe-manual/
```

#### 5c. Verify Frontend Pages
```bash
# Check unsubscribe pages exist
ls -la Frontend/app/ | grep unsubscribe

# Should show:
# unsubscribe-success/
# unsubscribe-error/
```

---

### STEP 6: End-to-End Testing
**Time: 15 minutes**

#### Test Full Flow:

**Step 1: Create test user in database**
```sql
-- Run in Supabase SQL Editor
INSERT INTO users (email, name, company_id, email_unsubscribed)
VALUES ('testflow@example.com', 'Test User', 'YOUR_COMPANY_ID', false)
RETURNING user_id;

-- Copy the returned user_id
```

**Step 2: Generate unsubscribe link**
```bash
curl -X POST http://localhost:8000/api/unsubscribe/generate-token \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testflow@example.com",
    "user_id": "YOUR_USER_ID_FROM_STEP_1"
  }'

# Copy the "unsubscribe_url" from response
# Format: http://localhost:3000/api/unsubscribe?token=...
```

**Step 3: Test unsubscribe via URL (simulates email link click)**
```bash
# Open in browser or curl
curl -L "UNSUBSCRIBE_URL_FROM_STEP_2"

# Should redirect to: http://localhost:3000/unsubscribe-success?email=testflow@example.com
```

**Step 4: Verify database update**
```sql
-- Run in Supabase SQL Editor
SELECT user_id, email, email_unsubscribed, unsubscribed_at 
FROM users 
WHERE email = 'testflow@example.com';

-- Should show:
-- email_unsubscribed: true
-- unsubscribed_at: current timestamp
```

**Step 5: Test resubscribe**
```bash
curl -X POST http://localhost:3000/api/resubscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "testflow@example.com"}'

# Expected: {"success": true, "message": "You have been re-subscribed..."}
```

**Step 6: Verify resubscribe in database**
```sql
SELECT user_id, email, email_unsubscribed, unsubscribed_at 
FROM users 
WHERE email = 'testflow@example.com';

-- Should show:
-- email_unsubscribed: false
-- unsubscribed_at: NULL
```

---

### STEP 7: Integration with Email Senders
**Time: 30 minutes**

This is the critical step where you update your email sending code.

#### 7a. Identify All Email Sending Functions

Search for these patterns in your codebase:
```bash
# Search for email sending functions
grep -r "sendmail\|smtp\|send_email\|send_notification" Backend/routes/ --include="*.py" | grep -i "def " | head -20
```

Common locations:
- `Backend/routes/dispatch.py` — Email dispatch endpoints
- `Frontend/app/api/send-module-notifications/route.ts` — Module notifications
- `Frontend/app/api/notify-admin-completion/route.ts` — Admin notifications

#### 7b. Update Each Email Sender

For Python (Backend):
```python
# Add at top of function
from utils.email_helper import should_send_email, prepare_email_html, prepare_email_text

# Before sending email:
should_send, reason = await should_send_email(recipient_email, reason="your_reason")
if not should_send:
    logger.info(f"Email skipped: {reason}")
    return  # Skip this user

# Prepare email with unsubscribe link:
html = await prepare_email_html(html_template, email, user_id, frontend_url)
text = await prepare_email_text(text_template, email, user_id, frontend_url)

# Then send as usual with your SMTP code
```

For JavaScript/TypeScript (Frontend):
```typescript
import { generateUnsubscribeToken, buildUnsubscribeUrl } from '@/lib/unsubscribe-token'

// Generate token
const token = generateUnsubscribeToken(email, userId)
const unsubscribeUrl = buildUnsubscribeUrl(token)

// Pass to email template
const emailTemplate = generateTemplate(
  ...params,
  unsubscribeUrl  // ← Add this parameter
)

// Template uses: <a href={unsubscribeUrl}>Unsubscribe</a>
```

See `Backend/UNSUBSCRIBE_INTEGRATION_EXAMPLE.py` for complete examples.

#### 7c. Update Email Templates

Find all email templates and replace:

```html
<!-- OLD (broken) -->
<a href="#">Unsubscribe</a>
<a href="javascript:void(0)">Unsubscribe</a>

<!-- NEW (working) -->
<a href="{{ unsubscribe_url }}">Unsubscribe</a>
<a href={unsubscribeUrl}>Unsubscribe</a>
```

Also add plain text fallback:
```text
To manage your email preferences: {unsubscribe_url}
```

---

### STEP 8: Bulk Send Filtering
**Time: 10 minutes**

For all bulk email operations, add filter:

#### Python/Supabase:
```python
# Before:
users = supabase.table("users").select("*").eq("company_id", company_id).execute()

# After:
users = supabase.table("users").select("*").eq(
    "company_id", company_id
).eq("email_unsubscribed", False).execute()  # ← Add this
```

#### PostgreSQL/SQL:
```sql
-- Before:
SELECT * FROM users WHERE company_id = $1;

-- After:
SELECT * FROM users 
WHERE company_id = $1 
AND email_unsubscribed = false;  -- ← Add this
```

---

### STEP 9: Run Tests
**Time: 10 minutes**

```bash
cd Backend

# Run unsubscribe token tests
pytest test_unsubscribe.py -v

# Expected output:
# test_unsubscribe.py::TestTokenGeneration::test_generate_valid_token PASSED
# test_unsubscribe.py::TestTokenVerification::test_verify_valid_token PASSED
# ... (all tests pass)

# With coverage
pytest test_unsubscribe.py --cov=utils.unsubscribe_token --cov-report=html
```

---

### STEP 10: Staging Deployment
**Time: Variable**

1. Push code to staging environment
2. Re-run database migration on staging
3. Set environment variables on staging
4. Run full end-to-end test flow
5. Send test emails with unsubscribe links
6. Click unsubscribe links from email clients
7. Verify database updates
8. Check logs for any errors

---

### STEP 11: Production Deployment
**Time: Variable**

#### Pre-Production Checklist:
- [ ] All tests pass locally
- [ ] Staging deployment successful
- [ ] All email sending code updated
- [ ] All email templates updated
- [ ] Database backup taken
- [ ] Rollback plan documented
- [ ] Monitoring/alerts configured

#### Deployment:
1. Tag release: `git tag v1.0.0-unsubscribe`
2. Push to production branch
3. Apply database migration to production
4. Deploy backend
5. Deploy frontend
6. Monitor logs for errors
7. Send test emails
8. Verify unsubscribe flow works

#### Post-Deployment:
- [ ] Monitor error logs
- [ ] Check email sending volumes
- [ ] Verify unsubscribe processing
- [ ] Monitor database indices
- [ ] Test from different email clients

---

## 🚨 Troubleshooting

### Issue: "UNSUBSCRIBE_SECRET not configured"

**Solution:**
```bash
# Check .env
cat .env | grep UNSUBSCRIBE_SECRET

# If not there, generate and add:
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Add to .env:
UNSUBSCRIBE_SECRET=<your-generated-secret>

# Restart server
```

### Issue: "Token verification failed"

**Solution:**
```bash
# Check secret matches frontend and backend
echo "Backend secret:" $UNSUBSCRIBE_SECRET
echo "Frontend secret:" $UNSUBSCRIBE_SECRET  # Should be same

# Check token age (must be < 30 days)
python3 << 'EOF'
from utils.unsubscribe_token import get_token_expiry_date
expiry = get_token_expiry_date("YOUR_TOKEN")
print(f"Expires: {expiry}")
EOF
```

### Issue: "Email still sent after unsubscribe"

**Solution:**
1. Verify database updated:
   ```sql
   SELECT email_unsubscribed FROM users WHERE email = 'test@example.com';
   ```
2. Check email sender code calls `should_send_email()`
3. Verify bulk queries filter by `email_unsubscribed = false`

### Issue: "Unsubscribe link returns 404"

**Solution:**
1. Check FRONTEND_URL env variable is set
2. Check /api/unsubscribe endpoint is registered
3. Test endpoint directly:
   ```bash
   curl http://localhost:8000/api/unsubscribe/generate-token
   ```

---

## 📊 Monitoring

### Key Metrics to Track

```sql
-- Unsubscribe rate
SELECT COUNT(*) as unsubscribed_count
FROM users
WHERE email_unsubscribed = true;

-- Unsubscribes in last 7 days
SELECT DATE(unsubscribed_at), COUNT(*) as daily_unsubscribes
FROM users
WHERE email_unsubscribed = true
AND unsubscribed_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(unsubscribed_at);

-- Company-level unsubscribe rates
SELECT 
  c.name,
  COUNT(u.user_id) as total_users,
  COUNT(CASE WHEN u.email_unsubscribed THEN 1 END) as unsubscribed,
  ROUND(100.0 * COUNT(CASE WHEN u.email_unsubscribed THEN 1 END) / COUNT(u.user_id), 2) as pct_unsubscribed
FROM users u
JOIN companies c ON u.company_id = c.company_id
GROUP BY c.company_id, c.name
ORDER BY pct_unsubscribed DESC;
```

### Log Monitoring

```bash
# Monitor for unsubscribe activity
tail -f logs/app.log | grep -i "unsubscrib"

# Check for token errors
tail -f logs/app.log | grep -i "token"

# Monitor email send errors
tail -f logs/app.log | grep -i "email.*fail"
```

---

## 📞 Support & Escalation

If you encounter issues:

1. **Check logs first:**
   ```bash
   grep -i "unsubscribe\|token\|email" logs/app.log | tail -50
   ```

2. **Run diagnostic:**
   ```python
   # Backend diagnostic
   python3 Backend/test_unsubscribe.py
   ```

3. **Check database state:**
   ```sql
   -- Count unsubscribed users
   SELECT COUNT(*) FROM users WHERE email_unsubscribed = true;
   
   -- Check indices exist
   SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname LIKE '%unsubscribe%';
   ```

4. **Review documentation:**
   - See: `UNSUBSCRIBE_IMPLEMENTATION.md` for detailed technical info
   - See: `UNSUBSCRIBE_INTEGRATION_EXAMPLE.py` for code examples

---

## ✅ Deployment Sign-Off

After completing all steps, verify:

- [ ] Environment variables set
- [ ] Database migration applied
- [ ] All tests passing
- [ ] Backend endpoints responding
- [ ] Frontend pages loading
- [ ] End-to-end flow working
- [ ] Email templates updated
- [ ] All email senders updated
- [ ] Bulk queries filtering unsubscribed
- [ ] Monitoring configured
- [ ] Logs reviewed for errors
- [ ] Rollback plan documented

**Status:** Ready for production ✅

---

**Last Updated:** March 2026
**Version:** 1.0.0
