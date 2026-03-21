'use client';

/**
 * Unsubscribe Success Page
 * Displayed after user successfully unsubscribes from emails
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function UnsubscribeSuccessPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || 'your email address';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
        {/* Success Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-green-100 rounded-full p-4 w-16 h-16 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Successfully Unsubscribed</h1>

        {/* Message */}
        <p className="text-gray-600 mb-2">
          You have been unsubscribed from our email list.
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Email: <span className="font-medium text-gray-700">{email}</span>
        </p>

        {/* Details */}
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6 text-left">
          <h2 className="font-semibold text-gray-900 mb-2">What happens next?</h2>
          <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
            <li>You will no longer receive marketing emails</li>
            <li>You may still receive transactional emails (password reset, etc.)</li>
            <li>You can re-subscribe at any time</li>
          </ul>
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
            href="/account-settings"
            className="block w-full bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold py-2 px-4 rounded-lg transition duration-200"
          >
            Account Settings
          </Link>
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-500 mt-6">
          This action was requested on {new Date().toLocaleDateString()} at{' '}
          {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
