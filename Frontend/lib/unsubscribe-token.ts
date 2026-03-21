/**
 * Email Unsubscribe Token Generation & Verification
 * 
 * Implements HMAC-SHA256 token generation for GDPR/CAN-SPAM compliance
 * Token format: base64url(payload).base64url(signature)
 * Tokens expire after 30 days
 * 
 * Usage:
 *   const token = generateUnsubscribeToken(email, userId);
 *   const isValid = verifyUnsubscribeToken(token);
 *   const url = buildUnsubscribeUrl(token);
 */

import crypto from 'crypto';

/**
 * Error thrown when secret is missing or invalid
 */
export class MissingSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingSecretError';
  }
}

/**
 * Error thrown when token is invalid
 */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Error thrown when token has expired
 */
export class ExpiredTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpiredTokenError';
  }
}

/**
 * Get the UNSUBSCRIBE_SECRET from environment
 * Must be at least 32 characters for HMAC-SHA256
 * 
 * @throws {MissingSecretError} If secret is not set or too short
 */
function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;

  if (!secret) {
    throw new MissingSecretError('UNSUBSCRIBE_SECRET environment variable is not set');
  }

  if (secret.length < 32) {
    throw new MissingSecretError(
      `UNSUBSCRIBE_SECRET must be at least 32 characters long (got ${secret.length})`
    );
  }

  return secret;
}

/**
 * Encode data to base64url (RFC 4648)
 * Removes padding (=) and replaces +/- with -_
 */
function toBase64Url(data: string | Buffer): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decode base64url data back to string
 */
function fromBase64Url(encoded: string): Buffer {
  // Add padding if needed
  const padding = 4 - (encoded.length % 4);
  const padded = padding !== 4 ? encoded + '='.repeat(padding) : encoded;

  // Replace URL-safe characters with standard base64
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(standard, 'base64');
}

/**
 * Generate HMAC-SHA256 signature for payload
 * 
 * @param payload - The data to sign
 * @param secret - The secret key
 * @returns base64url encoded signature
 */
function signPayload(payload: string, secret: string): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest();

  return toBase64Url(signature);
}

/**
 * Verify HMAC-SHA256 signature using constant-time comparison
 * 
 * @param payload - The original payload
 * @param signature - The base64url encoded signature to verify
 * @param secret - The secret key
 * @returns true if signature is valid
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = signPayload(payload, secret);

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let match = 0;
  for (let i = 0; i < signature.length; i++) {
    match |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return match === 0;
}

/**
 * Calculate token expiration date (30 days from now)
 * 
 * @returns ISO 8601 timestamp string
 */
function calculateTokenExpiryDate(): string {
  const now = new Date();
  const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  return expiry.toISOString();
}

/**
 * Generate unsubscribe token for email and user
 * 
 * Token structure:
 * - payload: base64url(JSON with email, userId, expiresAt)
 * - signature: base64url(HMAC-SHA256(payload, secret))
 * - final token: payload.signature
 * 
 * @param email - User email address
 * @param userId - User ID
 * @returns base64url token in format "payload.signature"
 * @throws {MissingSecretError} If UNSUBSCRIBE_SECRET is not set
 * 
 * @example
 * const token = generateUnsubscribeToken('user@example.com', 'uuid-123');
 * // Returns: "eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJ1c2VySWQiOiJ1dWlkLTEyMyIsImV4cGlyZXNBdCI6IjIwMjQtMDQtMTRUMTI6MDA6MDBaIn0.xyz..."
 */
export function generateUnsubscribeToken(email: string, userId: string): string {
  const secret = getSecret();

  // Create payload with expiration
  const payload = {
    email,
    userId,
    expiresAt: calculateTokenExpiryDate(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(payloadJson);
  const signature = signPayload(payloadEncoded, secret);

  return `${payloadEncoded}.${signature}`;
}

/**
 * Verify and decode unsubscribe token
 * 
 * Checks:
 * 1. Token format (must have two parts separated by .)
 * 2. Signature validity (HMAC-SHA256)
 * 3. Expiration (must not be older than 30 days)
 * 
 * @param token - The token to verify
 * @returns Decoded payload { email, userId, expiresAt }
 * @throws {InvalidTokenError} If token format or signature is invalid
 * @throws {ExpiredTokenError} If token has expired
 * @throws {MissingSecretError} If UNSUBSCRIBE_SECRET is not set
 * 
 * @example
 * try {
 *   const data = verifyUnsubscribeToken(token);
 *   console.log(data.email); // 'user@example.com'
 * } catch (error) {
 *   if (error instanceof ExpiredTokenError) {
 *     console.error('Token has expired');
 *   }
 * }
 */
export function verifyUnsubscribeToken(
  token: string
): { email: string; userId: string; expiresAt: string } {
  const secret = getSecret();

  // Validate token format
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new InvalidTokenError('Token must contain exactly 2 parts separated by a dot');
  }

  const [payloadEncoded, signature] = parts;

  // Verify signature
  if (!verifySignature(payloadEncoded, signature, secret)) {
    throw new InvalidTokenError('Token signature is invalid');
  }

  // Decode and parse payload
  let payload;
  try {
    const decoded = fromBase64Url(payloadEncoded).toString('utf-8');
    payload = JSON.parse(decoded);
  } catch (error) {
    throw new InvalidTokenError('Token payload could not be decoded');
  }

  // Validate payload structure
  if (!payload.email || !payload.userId || !payload.expiresAt) {
    throw new InvalidTokenError('Token payload is missing required fields');
  }

  // Check expiration
  const expiresAt = new Date(payload.expiresAt);
  const now = new Date();
  if (now > expiresAt) {
    throw new ExpiredTokenError('Token has expired');
  }

  return {
    email: payload.email,
    userId: payload.userId,
    expiresAt: payload.expiresAt,
  };
}

/**
 * Get token expiration date in ISO 8601 format
 * Useful for displaying to users when token was generated and will expire
 * 
 * @param token - The token to check
 * @returns ISO 8601 timestamp when token expires
 * @throws {InvalidTokenError} If token format is invalid
 * 
 * @example
 * const expiresAt = getTokenExpiryDate(token);
 * console.log(`Token expires at: ${expiresAt}`);
 */
export function getTokenExpiryDate(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new InvalidTokenError('Token must contain exactly 2 parts separated by a dot');
  }

  const payloadEncoded = parts[0];
  let payload;
  try {
    const decoded = fromBase64Url(payloadEncoded).toString('utf-8');
    payload = JSON.parse(decoded);
  } catch (error) {
    throw new InvalidTokenError('Token payload could not be decoded');
  }

  if (!payload.expiresAt) {
    throw new InvalidTokenError('Token payload is missing expiresAt field');
  }

  return payload.expiresAt;
}

/**
 * Build full unsubscribe URL from token
 * 
 * @param token - The unsubscribe token
 * @param baseUrl - Optional base URL (defaults to FRONTEND_URL env var or current host)
 * @returns Full URL with token parameter
 * 
 * @example
 * const url = buildUnsubscribeUrl(token);
 * // Returns: "https://lucid.workfloww.ai/unsubscribe?token=..."
 */
export function buildUnsubscribeUrl(token: string, baseUrl?: string): string {
  // Determine base URL
  let url = baseUrl;
  if (!url) {
    // Try to get from environment
    url = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL;

    // Fallback for development
    if (!url) {
      if (typeof window !== 'undefined') {
        url = window.location.origin;
      } else {
        url = 'http://localhost:3000';
      }
    }
  }

  // Ensure URL doesn't have trailing slash
  url = url.replace(/\/$/, '');

  return `${url}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Build email unsubscribe link for use in email templates
 * Creates a clickable link for browser-based unsubscribe
 * 
 * @param token - The unsubscribe token
 * @param linkText - Text to display in the link (default: "Unsubscribe")
 * @returns HTML anchor tag
 * 
 * @example
 * const link = buildUnsubscribeLink(token);
 * // Returns: '<a href="https://lucid.workfloww.ai/unsubscribe?token=...">Unsubscribe</a>'
 */
export function buildUnsubscribeLink(token: string, linkText: string = 'Unsubscribe'): string {
  const url = buildUnsubscribeUrl(token);
  return `<a href="${url}">${linkText}</a>`;
}
