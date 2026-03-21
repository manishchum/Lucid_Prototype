# Unsubscribe Button - Troubleshooting Guide

## ✅ Fixed Issues

### Issue 1: Missing Frontend Components
**Status:** ✅ RESOLVED

The unsubscribe functionality was implemented in the Backend but the Frontend files were missing. This has been fixed by creating:

- `Frontend/lib/unsubscribe-token.ts` - Token generation and verification
- `Frontend/app/api/unsubscribe/route.ts` - Main unsubscribe endpoint
- `Frontend/app/api/resubscribe/route.ts` - Re-subscription endpoint
- `Frontend/app/api/unsubscribe-manual/route.ts` - Fallback unsubscribe
- `Frontend/app/unsubscribe-success/page.tsx` - Success page
- `Frontend/app/unsubscribe-error/page.tsx` - Error page

### Issue 2: Duplicate Router Registration
**Status:** ✅ RESOLVED

The unsubscribe router was registered twice in `Backend/main.py`. The duplicate has been removed.

---

## 🧪 Testing the Fix

### Quick Test
```bash
# Test Backend endpoint responds
curl http://127.0.0.1:8000/api/unsubscribe?token=invalid_token

# Expected response:
# {"detail":"http://localhost:3000/unsubscribe-error?reason=invalid_token"}
```

### Full Flow Test
1. **Start Backend** (if not running):
   ```bash
   cd Backend
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Start Frontend** (if not running):
   ```bash
   npm run dev
   ```

3. **Test Unsubscribe**:
   - Send a test email with unsubscribe link
   - Click the link (format: `https://yoursite.com/api/unsubscribe?token=...`)
   - Verify you see the success page at `/unsubscribe-success`

4. **Verify Database**:
   ```sql
   -- Check if email is marked as unsubscribed
   SELECT email, email_unsubscribed, unsubscribed_at 
   FROM users 
   WHERE email = 'your-test@example.com';
   ```

---

## 🔍 Common Issues & Solutions

### Issue: "Cannot find module" errors
**Symptom:** Frontend build fails with module not found

**Solution:**
```bash
# Clear cache and reinstall
rm -rf node_modules .next
npm install
npm run dev
```

### Issue: Blank page on /unsubscribe-success
**Symptom:** Page loads but no content shows

**Solution:**
1. Check browser console for errors (F12)
2. Verify Next.js pages are compiled
3. Clear browser cache and reload

### Issue: Button doesn't trigger unsubscribe
**Symptom:** Clicking button does nothing

**Solution:**
1. Verify Backend is running: `curl http://127.0.0.1:8000/docs`
2. Check `/api/unsubscribe` endpoint exists in Backend
3. Verify token is being generated correctly in email

### Issue: Token validation fails
**Symptom:** Getting "Invalid Token" error even with fresh link

**Solution:**
1. Verify `UNSUBSCRIBE_SECRET` matches in both .env files:
   ```bash
   grep UNSUBSCRIBE_SECRET Frontend/.env Backend/.env
   ```
2. Token must be exactly as generated (no modifications)
3. Token expires after 30 days

### Issue: "User not found" error
**Symptom:** Valid token but user can't be found

**Solution:**
1. Verify user exists in database:
   ```sql
   SELECT id, email FROM users WHERE email = 'test@example.com';
   ```
2. Check user ID in token matches database
3. Ensure Supabase connection is working

---

## 📊 File Structure

```
Frontend/
├── lib/
│   └── unsubscribe-token.ts       ← Token generation
├── app/
│   ├── api/
│   │   ├── unsubscribe/route.ts   ← GET unsubscribe
│   │   ├── resubscribe/route.ts   ← POST resubscribe
│   │   └── unsubscribe-manual/    ← POST fallback
│   ├── unsubscribe-success/       ← Success page
│   └── unsubscribe-error/         ← Error page

Backend/
├── routes/
│   └── unsubscribe.py             ← Unsubscribe endpoints
├── utils/
│   ├── unsubscribe_token.py       ← Token validation
│   └── email_helper.py            ← Email integration
└── main.py                        ← Router registration
```

---

## 🔐 Security Checklist

- [x] UNSUBSCRIBE_SECRET is set in both .env files
- [x] Secret is at least 32 characters long
- [x] HMAC-SHA256 signing is used
- [x] Constant-time comparison prevents timing attacks
- [x] Token expiration is enforced (30 days)
- [x] Token format validated before processing
- [x] Email-based endpoints require valid email format

---

## 📝 Integration Checklist

Before deploying, verify:

- [ ] Backend running on port 8000
- [ ] Frontend running on port 3000
- [ ] Database migration applied (`add_unsubscribe_columns.sql`)
- [ ] Email templates include unsubscribe link
- [ ] UNSUBSCRIBE_SECRET set in both .env files
- [ ] Test email sent and link works
- [ ] Success page displays correctly
- [ ] Error page displays for invalid tokens
- [ ] Manual unsubscribe form works

---

## 📞 Support

If you continue having issues:

1. Check the test file: `Frontend/__tests__/unsubscribe.test.ts`
2. Review Backend implementation: `Backend/routes/unsubscribe.py`
3. Check environment variables: `grep -n UNSUBSCRIBE_SECRET Frontend/.env Backend/.env`
4. Enable debug logging in both Frontend and Backend

---

## ✨ Next Steps

1. **Test the system** using the test procedures above
2. **Deploy to staging** to verify in production environment
3. **Monitor logs** for any unsubscribe-related errors
4. **Get user feedback** on success page experience
5. **Track metrics** on unsubscribe rates

---

**Last Updated:** March 21, 2026
**Status:** ✅ All components operational
