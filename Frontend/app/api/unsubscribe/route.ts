/**
 * GET /api/unsubscribe - Browser-based unsubscribe endpoint
 * 
 * Accepts token as query parameter and redirects to unsubscribe success/error page
 * This is the endpoint called when user clicks unsubscribe link in email
 * 
 * Query Parameters:
 *   token: string - The unsubscribe token generated during email sending
 * 
 * Redirects to:
 *   /unsubscribe-success - If unsubscribe is successful
 *   /unsubscribe-error - If token is invalid or expired
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(new URL('/unsubscribe-error?reason=missing_token', request.url));
    }

    // Call backend API to process unsubscribe
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
    const response = await fetch(`${backendUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const reason = errorData.detail || 'unknown_error';
      return NextResponse.redirect(
        new URL(`/unsubscribe-error?reason=${encodeURIComponent(reason)}`, request.url)
      );
    }

    // Success - redirect to success page
    return NextResponse.redirect(new URL('/unsubscribe-success', request.url));
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return NextResponse.redirect(
      new URL('/unsubscribe-error?reason=server_error', request.url)
    );
  }
}
