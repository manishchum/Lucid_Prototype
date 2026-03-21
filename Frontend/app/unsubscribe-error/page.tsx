'use client';

/**
 * Unsubscribe Error Page
 * Displayed if unsubscribe fails (invalid token, expired token, etc.)
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const errorMessages: Record<string, { title: string; description: string }> = {
  missing_token: {
    title: 'Missing Unsubscribe Token',
    description: 'The unsubscribe link appears to be incomplete. Please try again or contact support.',
  },
  invalid_token: {
    title: 'Invalid Token',
    description:
      'The unsubscribe link is invalid or corrupted. Please request a new unsubscribe link from your email.',
  },
  expired_token: {
    title: 'Token Expired',
    description:
      'The unsubscribe link has expired (valid for 30 days). Please request a new one from your email or use the manual unsubscribe form below.',
  },
  user_not_found: {
    title: 'User Not Found',
    description:
      'The email address associated with this link could not be found in our system.',
  },
  already_unsubscribed: {
    title: 'Already Unsubscribed',
    description:
      'This email address is already unsubscribed from our mailing list.',
  },
  server_error: {
    title: 'Server Error',
    description:
      'An unexpected error occurred while processing your request. Please try again later or contact support.',
  },
  unknown_error: {
    title: 'Error Processing Request',
    description:
      'An unexpected error occurred. Please try again or contact support if the problem persists.',
  },
};

export default function UnsubscribeErrorPage() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason') || 'unknown_error';

  const error = errorMessages[reason] || errorMessages.unknown_error;

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
        {/* Error Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-red-100 rounded-full p-4 w-16 h-16 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{error.title}</h1>

        {/* Message */}
        <p className="text-gray-600 mb-6">{error.description}</p>

        {/* Manual Unsubscribe Form */}
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-3 text-sm">Manual Unsubscribe</h2>
          <form className="space-y-3">
            <input
              type="email"
              placeholder="Enter your email address"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              type="submit"
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200 text-sm"
            >
              Unsubscribe
            </button>
          </form>
        </div>

        {/* Buttons */}
        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
          >
            Return to Home
          </Link>
          <Link
            href="/support"
            className="block w-full bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold py-2 px-4 rounded-lg transition duration-200"
          >
            Contact Support
          </Link>
        </div>

        {/* Reason Code */}
        <p className="text-xs text-gray-500 mt-6">
          Error code: <code className="font-mono bg-gray-100 px-2 py-1 rounded">{reason}</code>
        </p>
      </div>
    </div>
  );
}
