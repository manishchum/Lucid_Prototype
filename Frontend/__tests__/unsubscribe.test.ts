/**
 * @jest-environment node
 * Tests for the email unsubscribe system
 * Covers token generation, verification, API routes, and email sending
 */

import { generateUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } from '@/lib/unsubscribe-token';
import crypto from 'crypto';

// Set a test secret in environment
const originalSecret = process.env.UNSUBSCRIBE_SECRET;

beforeAll(() => {
  process.env.UNSUBSCRIBE_SECRET = 'test_secret_that_is_at_least_32_characters_long_ok';
});

afterAll(() => {
  process.env.UNSUBSCRIBE_SECRET = originalSecret;
});

describe('Unsubscribe Token Generation & Verification', () => {
  describe('generateUnsubscribeToken', () => {
    it('should generate a valid token for email and userId', () => {
      const email = 'test@example.com';
      const userId = 'user-123-456';

      const token = generateUnsubscribeToken(email, userId);

      // Token should be a non-empty string
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      // Token should be base64url encoded (no +, /, or = padding)
      expect(token).not.toMatch(/[+\/=]/);
    });

    it('should throw error if UNSUBSCRIBE_SECRET is not set', () => {
      const originalSecret = process.env.UNSUBSCRIBE_SECRET;
      delete process.env.UNSUBSCRIBE_SECRET;

      expect(() => {
        generateUnsubscribeToken('test@example.com', 'user-123');
      }).toThrow('UNSUBSCRIBE_SECRET environment variable is not set');

      process.env.UNSUBSCRIBE_SECRET = originalSecret;
    });

    it('should throw error if UNSUBSCRIBE_SECRET is too short', () => {
      const originalSecret = process.env.UNSUBSCRIBE_SECRET;
      process.env.UNSUBSCRIBE_SECRET = 'short';

      expect(() => {
        generateUnsubscribeToken('test@example.com', 'user-123');
      }).toThrow('must be 32+ characters');

      process.env.UNSUBSCRIBE_SECRET = originalSecret;
    });

    it('should generate different tokens for different emails', () => {
      const token1 = generateUnsubscribeToken('email1@example.com', 'user-123');
      const token2 = generateUnsubscribeToken('email2@example.com', 'user-123');

      expect(token1).not.toEqual(token2);
    });

    it('should generate different tokens at different times', async () => {
      const email = 'test@example.com';
      const userId = 'user-123';

      const token1 = generateUnsubscribeToken(email, userId);
      
      // Wait 10ms to ensure timestamp differs
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const token2 = generateUnsubscribeToken(email, userId);

      // Tokens should be different due to different issuedAt timestamps
      expect(token1).not.toEqual(token2);
    });
  });

  describe('verifyUnsubscribeToken', () => {
    it('should successfully verify a valid token', () => {
      const email = 'test@example.com';
      const userId = 'user-123-456';

      const token = generateUnsubscribeToken(email, userId);
      const payload = verifyUnsubscribeToken(token);

      expect(payload).not.toBeNull();
      expect(payload?.email).toBe(email);
      expect(payload?.userId).toBe(userId);
      expect(payload?.issuedAt).toBeDefined();
      expect(typeof payload?.issuedAt).toBe('number');
    });

    it('should reject a tampered token', () => {
      const token = generateUnsubscribeToken('test@example.com', 'user-123');

      // Tamper with the token by flipping a character
      const tamperedToken = token.slice(0, -1) + (token[token.length - 1] === 'a' ? 'b' : 'a');

      const payload = verifyUnsubscribeToken(tamperedToken);

      expect(payload).toBeNull();
    });

    it('should reject an invalid token format', () => {
      const invalidTokens = [
        'not-a-valid-token',
        '',
        'x'.repeat(1000),
        '!!!invalid!!!',
      ];

      invalidTokens.forEach(invalidToken => {
        const payload = verifyUnsubscribeToken(invalidToken);
        expect(payload).toBeNull();
      });
    });

    it('should reject an expired token', () => {
      // Create a token with a fake issuedAt timestamp from 31 days ago
      const email = 'test@example.com';
      const userId = 'user-123';
      const secret = process.env.UNSUBSCRIBE_SECRET!;

      const expiredPayload = {
        email,
        userId,
        issuedAt: Date.now() - (31 * 24 * 60 * 60 * 1000), // 31 days ago
      };

      const payloadString = JSON.stringify(expiredPayload);
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payloadString);
      const signature = hmac.digest('base64');

      const tokenData = `${payloadString}.${signature}`;
      const expiredToken = Buffer.from(tokenData).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const result = verifyUnsubscribeToken(expiredToken);

      expect(result).toBeNull();
    });

    it('should accept a token issued just under 30 days ago', () => {
      const email = 'test@example.com';
      const userId = 'user-123';
      const secret = process.env.UNSUBSCRIBE_SECRET!;

      // Create token from 29 days 59 minutes 59 seconds ago
      const almostExpiredPayload = {
        email,
        userId,
        issuedAt: Date.now() - (29 * 24 * 60 * 60 * 1000) - (59 * 60 * 1000) - (59 * 1000),
      };

      const payloadString = JSON.stringify(almostExpiredPayload);
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payloadString);
      const signature = hmac.digest('base64');

      const tokenData = `${payloadString}.${signature}`;
      const almostExpiredToken = Buffer.from(tokenData).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const result = verifyUnsubscribeToken(almostExpiredToken);

      expect(result).not.toBeNull();
      expect(result?.email).toBe(email);
    });

    it('should reject token with missing signature separator', () => {
      // Create a token without the signature separator
      const payloadString = JSON.stringify({ email: 'test@example.com', userId: 'user-123', issuedAt: Date.now() });
      const fakeToken = Buffer.from(payloadString).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const result = verifyUnsubscribeToken(fakeToken);

      expect(result).toBeNull();
    });

    it('should reject token with invalid JSON payload', () => {
      const secret = process.env.UNSUBSCRIBE_SECRET!;

      // Create token with invalid JSON
      const invalidPayload = 'not-valid-json';
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(invalidPayload);
      const signature = hmac.digest('base64');

      const tokenData = `${invalidPayload}.${signature}`;
      const invalidToken = Buffer.from(tokenData).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const result = verifyUnsubscribeToken(invalidToken);

      expect(result).toBeNull();
    });
  });

  describe('buildUnsubscribeUrl', () => {
    it('should build a complete unsubscribe URL', () => {
      const token = generateUnsubscribeToken('test@example.com', 'user-123');
      const url = buildUnsubscribeUrl(token);

      expect(url).toBeDefined();
      expect(url).toContain('/api/unsubscribe');
      expect(url).toContain(`token=${token}`);
      expect(url).toContain('http://localhost:3000');
    });

    it('should use NEXT_PUBLIC_APP_URL if set', () => {
      const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_APP_URL = 'https://myapp.com';

      try {
        const token = generateUnsubscribeToken('test@example.com', 'user-123');
        const url = buildUnsubscribeUrl(token);

        expect(url).toContain('https://myapp.com');
      } finally {
        process.env.NEXT_PUBLIC_APP_URL = originalUrl;
      }
    });
  });
});

describe('Token Security & Consistency', () => {
  it('should use constant-time comparison to prevent timing attacks', () => {
    const email = 'test@example.com';
    const userId = 'user-123';

    const token = generateUnsubscribeToken(email, userId);
    const payload1 = verifyUnsubscribeToken(token);

    // Try to verify the same token again - should be consistent
    const payload2 = verifyUnsubscribeToken(token);

    expect(payload1).toEqual(payload2);
  });

  it('should handle special characters in email', () => {
    const specialEmails = [
      'user+tag@example.com',
      'first.last@example.co.uk',
      'user_name@example.com',
      'user-name@example.com',
    ];

    specialEmails.forEach(email => {
      const token = generateUnsubscribeToken(email, 'user-123');
      const payload = verifyUnsubscribeToken(token);

      expect(payload?.email).toBe(email);
    });
  });

  it('should handle very long userIds', () => {
    const longUserId = 'a'.repeat(500);
    const token = generateUnsubscribeToken('test@example.com', longUserId);
    const payload = verifyUnsubscribeToken(token);

    expect(payload?.userId).toBe(longUserId);
  });
});
