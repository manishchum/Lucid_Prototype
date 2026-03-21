# Email Unsubscribe System - Implementation Guide

This document describes the GDPR and CAN-SPAM compliant email unsubscribe system implemented in the Lucid Learning Platform.

## Overview

The system provides users with a secure, token-based unsubscribe mechanism that:
- ✅ Complies with GDPR (Article 21) and CAN-SPAM Act requirements
- ✅ Uses signed HMAC-SHA256 tokens to prevent tampering
- ✅ Automatically expires tokens after 30 days
- ✅ Provides fallback manual unsubscribe options
- ✅ Prevents email enumeration attacks
- ✅ Skips sending to unsubscribed users

## Architecture

### Token Generation
- **Location**: `lib/unsubscribe-token.ts`
- **Algorithm**: HMAC-SHA256 with base64url encoding
- **Payload**: `{ email, userId, issuedAt }`
- **Expiration**: 30 days
- **Secret**: `UNSUBSCRIBE_SECRET` environment variable (32+ characters)

### API Routes

#### GET /api/unsubscribe
- Handles clicks from email links
- Validates token signature and expiration
- Redirects to `/unsubscribe-success` or `/unsubscribe-error`

#### POST /api/unsubscribe
- Programmatic unsubscribe endpoint
- Returns JSON response
- Used by mobile apps and integrations

#### POST /api/resubscribe
- Allows users to re-subscribe
- Accepts email in request body
- Returns confirmation

#### POST /api/unsubscribe-manual
- Fallback unsubscribe without token
- Used when token is invalid/expired
- Implements email enumeration protection

### UI Pages

#### /unsubscribe-success
- Confirms successful unsubscribe
- Displays unsubscribed email
- Offers re-subscribe option

#### /unsubscribe-error
- Handles invalid/expired tokens
- Provides manual unsubscribe form
- Explains error reason

## Database Schema

### New Columns on `users` table

```sql
email_unsubscribed: boolean (default: false)
  - Tracks whether user has unsubscribed from emails
  
unsubscribed_at: timestamp (nullable)
  - Records when user unsubscribed
  - Used for analytics and compliance reporting
```

### Indexes
- `idx_users_email_unsubscribed`: For filtering subscribed users during bulk sends
- `idx_users_unsubscribed_at`: For analytics and reporting queries

## Environment Variables

### Required
```
UNSUBSCRIBE_SECRET=<random_32+_char_secret>
```

Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Optional
```
NEXT_PUBLIC_APP_URL=https://your-domain.com  # Defaults to FRONTEND_URL or localhost:3000
```

## Implementation Checklist

- [ ] Generate and set `UNSUBSCRIBE_SECRET` in `.env.local` and production environment
- [ ] Run database migration: `migrations/add_email_unsubscribe.sql`
- [ ] Email sending functions in use:
  - [x] `app/api/send-module-notifications/route.ts` - Updated
  - [x] `app/api/notify-admin-completion/route.ts` - Updated
  - [ ] Update any other email sending functions (find with: `grep -r "transporter.sendMail"`)
- [ ] Test unsubscribe flow manually:
  - [ ] Generate token for test user
  - [ ] Click unsubscribe link
  - [ ] Verify redirect and database update
  - [ ] Verify manual unsubscribe form
  - [ ] Verify re-subscribe flow
- [ ] Add integration tests to CI/CD pipeline
- [ ] Monitor unsubscribe metrics in analytics

## Usage Examples

### Generating Unsubscribe URL in Email

```typescript
import { generateUnsubscribeToken, buildUnsubscribeUrl } from '@/lib/unsubscribe-token';

// In email sending function:
const token = generateUnsubscribeToken(user.email, user.user_id);
const unsubscribeUrl = buildUnsubscribeUrl(token);

// Inject into email template:
const emailBody = `
  <a href="${unsubscribeUrl}">Unsubscribe</a>
`;
```

### Checking Before Sending Email

```typescript
// In email sending function:
const { data: user } = await supabase
  .from('users')
  .select('email_unsubscribed')
  .eq('user_id', userId)
  .single();

if (user?.email_unsubscribed) {
  console.log('Skipping email - user unsubscribed');
  return;
}

// Safe to send
await transporter.sendMail({...});
```

### Programmatic Unsubscribe (API)

```typescript
const response = await fetch('/api/unsubscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: unsubscribeToken })
});

const data = await response.json();
// { success: true, message: "You have been unsubscribed...", email: "..." }
```

## Security Considerations

### Token Security
- Tokens are signed with HMAC-SHA256
- Signature uses constant-time comparison to prevent timing attacks
- Tokens expire after 30 days
- Tampered tokens are rejected immediately

### Email Enumeration Prevention
- Manual unsubscribe endpoint returns same response for existing/non-existing emails
- Prevents attackers from discovering valid email addresses

### Rate Limiting
- Consider adding rate limiting to `/api/unsubscribe-manual` endpoint
- Suggested: Max 5 requests per IP per hour

### HTTPS Only
- All unsubscribe links should be HTTPS in production
- Ensure `NEXT_PUBLIC_APP_URL` uses HTTPS protocol

## Compliance

### GDPR (Articles 6 & 21)
- ✅ Users can withdraw consent to email processing
- ✅ Unsubscribe must be "as easy as subscribing"
- ✅ No retaliation for unsubscribing
- ✅ Records when user unsubscribed (`unsubscribed_at`)

### CAN-SPAM Act (Section 5)
- ✅ Honor unsubscribe requests within 10 business days (auto done immediately)
- ✅ Clear, conspicuous unsubscribe mechanism in all emails
- ✅ Plain text unsubscribe instruction in email body
- ✅ No need for user authentication to unsubscribe

### Best Practices
- ✅ One-click unsubscribe (no landing page required)
- ✅ Clear unsubscribe link placement (footer)
- ✅ Non-deceptive unsubscribe process
- ✅ No hidden unsubscribe mechanisms

## Troubleshooting

### "UNSUBSCRIBE_SECRET not properly configured"
- Ensure `UNSUBSCRIBE_SECRET` is set in `.env.local` or environment
- Secret must be 32+ characters
- Restart app after setting environment variable

### Token always rejected
- Verify `UNSUBSCRIBE_SECRET` hasn't changed
- Check token isn't older than 30 days
- Ensure token wasn't tampered with during transit

### Users still receiving emails after unsubscribing
- Check `email_unsubscribed` column was added to database
- Verify email sending function checks this column before sending
- Check for other email sending functions that don't use this check

### "User not found" on unsubscribe
- Verify email address in token matches database
- Check email field is lowercase (normalize in database queries)
- Ensure database migration was run

## Testing

Run the unsubscribe tests:

```bash
npm test -- __tests__/unsubscribe.test.ts
```

Test coverage includes:
- ✅ Valid token generation and verification
- ✅ Tampered token rejection
- ✅ Expired token rejection
- ✅ Invalid format rejection
- ✅ Email enumeration prevention
- ✅ Special character handling

## Monitoring & Analytics

### Queries for Reporting

```sql
-- Count unsubscribed users by company
SELECT c.name, COUNT(u.user_id) as unsubscribed_count
FROM users u
JOIN companies c ON u.company_id = c.company_id
WHERE u.email_unsubscribed = true
GROUP BY c.name;

-- Unsubscribe trends (last 30 days)
SELECT DATE(unsubscribed_at) as date, COUNT(*) as unsubscribes
FROM users
WHERE email_unsubscribed = true
  AND unsubscribed_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(unsubscribed_at)
ORDER BY date DESC;

-- Re-subscribe tracking (users with null unsubscribed_at but previously unsubscribed)
-- Note: Requires additional tracking table for audit trail
```

## Future Enhancements

1. **Preference Center**: Allow users to choose email types instead of all-or-nothing
2. **Audit Trail**: Track unsubscribe/resubscribe history
3. **Bounce Handling**: Auto-unsubscribe hard bounces
4. **Analytics Dashboard**: Admin UI for unsubscribe metrics
5. **SMS Alternative**: Allow SMS instead of email for key notifications
6. **Email Templates**: Admin-configurable email footer with unsubscribe link

## References

- [GDPR Article 21 - Right to Object](https://gdpr-info.eu/art-21-gdpr/)
- [CAN-SPAM Act - FTC Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [HMAC Token Best Practices](https://tools.ietf.org/html/rfc2104)
- [RFC 4648 - Base Encoding](https://tools.ietf.org/html/rfc4648)

## Support

For issues or questions about the unsubscribe system:
1. Check the Troubleshooting section above
2. Review test cases in `__tests__/unsubscribe.test.ts`
3. Check token generation logs: `lib/unsubscribe-token.ts`
4. Review API route logs: `app/api/unsubscribe/`, `app/api/resubscribe/`, `app/api/unsubscribe-manual/`
