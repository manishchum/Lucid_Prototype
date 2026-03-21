/**
 * EXACT CODE CHANGES - QUICK REFERENCE
 * Shows before/after for all modifications
 */

// =============================================================================
// 1. app/login/page.tsx - REMOVED bcryptjs import
// =============================================================================

// BEFORE (Line 17):
// import bcrypt from "bcryptjs"

// AFTER (Line 17):
// [REMOVED - no bcryptjs import]


// =============================================================================
// 2. app/login/page.tsx - REFACTORED password verification (Lines 86-100)
// =============================================================================

// BEFORE:
/*
      const isPasswordValid = await bcrypt.compare(password, userData.password)
      if (!isPasswordValid) {
        throw new Error("Invalid email or password")
      }
*/

// AFTER:
/*
      // Verify password using server-side API (bcryptjs cannot be used in client)
      const verifyRes = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          hashedPassword: userData.password
        })
      })

      if (!verifyRes.ok) {
        throw new Error("Invalid email or password")
      }

      const verifyPayload = await verifyRes.json()
      if (!verifyPayload.isValid) {
        throw new Error("Invalid email or password")
      }
*/


// =============================================================================
// 3. app/signup/page.tsx - REMOVED bcryptjs import
// =============================================================================

// BEFORE (Line 14):
// import bcrypt from "bcryptjs"

// AFTER (Line 14):
// [REMOVED - no bcryptjs import]


// =============================================================================
// 4. app/signup/page.tsx - REFACTORED password hashing (Lines 242-252)
// =============================================================================

// BEFORE:
/*
      // Hash the password
      const saltRounds = 12
      const hashedPassword = await bcrypt.hash(formData.password, saltRounds)

      // Insert user into database with company_id
      const createRes = await fetch(`${API_BASE}/api/users/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyData.company_id,
          name: formData.name,
          email: formData.email,
          password: hashedPassword,
          phone_number: formData.phoneNumber,
          hire_date: new Date().toISOString(),
          is_active: true
        })
      })
*/

// AFTER:
/*
      // Hash the password using server-side API (bcryptjs cannot be used in client)
      const hashRes = await fetch('/api/auth/hash-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: formData.password })
      })

      if (!hashRes.ok) {
        const hashErr = await hashRes.json()
        throw new Error(hashErr.error || 'Failed to hash password')
      }

      const hashPayload = await hashRes.json()
      const hashedPassword = hashPayload.hashedPassword

      // Insert user into database with company_id
      const createRes = await fetch(`${API_BASE}/api/users/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyData.company_id,
          name: formData.name,
          email: formData.email,
          password: hashedPassword,
          phone_number: formData.phoneNumber,
          hire_date: new Date().toISOString(),
          is_active: true
        })
      })
*/


// =============================================================================
// 5. .eslintrc.json - ADDED no-restricted-imports rule
// =============================================================================

// BEFORE:
/*
{
  "extends": [
    "next/core-web-vitals",
    "next/typescript"
  ]
}
*/

// AFTER:
/*
{
  "extends": [
    "next/core-web-vitals",
    "next/typescript"
  ],
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "name": "bcryptjs",
        "message": "❌ bcryptjs (password hashing) must only be used on the server..."
      },
      {
        "name": "nodemailer",
        "message": "❌ nodemailer (email sending) exposes SMTP credentials to client..."
      },
      {
        "name": "puppeteer",
        "message": "❌ puppeteer (headless browser) is Node.js-only..."
      },
      {
        "name": "libreoffice-convert",
        "message": "❌ libreoffice-convert (file conversion) requires system binaries..."
      },
      {
        "name": "fluent-ffmpeg",
        "message": "❌ fluent-ffmpeg (media processing) is Node.js-only..."
      },
      {
        "name": "openai",
        "message": "❌ openai (LLM API calls) exposes OpenAI API key to client..."
      }
    ]
  }
}
*/


// =============================================================================
// 6. next.config.mjs - ADDED bundle analyzer
// =============================================================================

// BEFORE:
/*
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  transpilePackages: [...],
  async headers() { ... }
}

export default nextConfig
*/

// AFTER:
/*
const withBundleAnalyzer = process.env.ANALYZE === 'true'
  ? (await import('@next/bundle-analyzer')).default({
      enabled: true,
      openAnalyzer: true,
    })
  : (config) => config

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  transpilePackages: [...],
  async headers() { ... }
}

export default withBundleAnalyzer(nextConfig)
*/


// =============================================================================
// 7. package.json - ADDED devDependencies and serverOnlyDependencies
// =============================================================================

// BEFORE:
/*
  "devDependencies": {
    "@types/node": "^22",
    "@types/nodemailer": "^7.0.3",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "ffmpeg-static": "^5.3.0",
    "ffprobe-static": "^3.1.0",
    "postcss": "^8.5",
    "tailwindcss": "^3.4.17",
    "typescript": "^5"
  }
}
*/

// AFTER:
/*
  "devDependencies": {
    "@next/bundle-analyzer": "^14.2.30",
    "@types/node": "^22",
    "@types/nodemailer": "^7.0.3",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "ffmpeg-static": "^5.3.0",
    "ffprobe-static": "^3.1.0",
    "postcss": "^8.5",
    "tailwindcss": "^3.4.17",
    "typescript": "^5",
    "server-only": "^0.0.1"
  },
  "serverOnlyDependencies": {
    "_comment": "CRITICAL: These packages MUST ONLY be used in server-side code...",
    "bcryptjs": "^3.0.3 - Password hashing. NEVER use in client components...",
    "nodemailer": "^7.0.10 - Email sending. NEVER use in client components...",
    "puppeteer": "^24.31.0 - Headless browser automation. NEVER use in client...",
    "libreoffice-convert": "^1.7.0 - File conversion. NEVER use in client...",
    "fluent-ffmpeg": "^2.1.3 - Media processing. NEVER use in client...",
    "openai": "^6.10.0 - LLM API calls. NEVER use in client..."
  }
}
*/


// =============================================================================
// 8. app/api/auth/hash-password/route.ts - NEW FILE (CREATED)
// =============================================================================

/*
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Invalid password provided' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    const saltRounds = 12
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    return NextResponse.json(
      { hashedPassword },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Password hashing error:', error)
    return NextResponse.json(
      { error: 'Failed to hash password' },
      { status: 500 }
    )
  }
}
*/


// =============================================================================
// 9. app/api/auth/verify-password/route.ts - NEW FILE (CREATED)
// =============================================================================

/*
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  try {
    const { password, hashedPassword } = await request.json()

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Invalid password provided' },
        { status: 400 }
      )
    }

    if (!hashedPassword || typeof hashedPassword !== 'string') {
      return NextResponse.json(
        { error: 'Invalid hash provided' },
        { status: 400 }
      )
    }

    const isValid = await bcrypt.compare(password, hashedPassword)

    return NextResponse.json(
      { isValid },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Password verification error:', error)
    return NextResponse.json(
      { error: 'Failed to verify password' },
      { status: 500 }
    )
  }
}
*/

export {}
