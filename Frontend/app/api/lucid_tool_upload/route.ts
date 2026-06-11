// File: Frontend/app/api/lucid_tool_upload/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// The URL of your running Python backend
const PYTHON_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the original request
    const formData = await request.formData();
    const userId = request.headers.get('X-User-ID');
    const companyId = request.headers.get('X-Company-ID');

    console.log('Proxy received:', {
      userId,
      companyId,
    });

    // Forward the form data to the Python backend
    const backendResponse = await fetch(`${PYTHON_BACKEND_URL}/api/lucid_tool_upload`, {
      method: 'POST',
      headers: {
        'X-User-ID': userId || '',
        'X-Company-ID': companyId || '',
      },
      body: formData,
      // IMPORTANT: Do not set Content-Type header manually when using FormData,
      // the browser or fetch will do it automatically with the correct boundary.
    });

    // Check if the backend call was successful
    if (!backendResponse.ok) {
      // If the backend returned an error, forward that error to the client
      const errorBody = await backendResponse.text();
      console.error('[API Proxy] Backend error:', errorBody);
      return new NextResponse(errorBody, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
      });
    }

    // If successful, get the JSON response from the backend and forward it
    const result = await backendResponse.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('[API Proxy] Error forwarding request:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
