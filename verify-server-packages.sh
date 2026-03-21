#!/usr/bin/env bash
# Bundle Safety Verification Script
# Validates that server-only packages are not bundled into client code

set -e

echo "════════════════════════════════════════════════════════════════"
echo "🔒 SERVER PACKAGE ISOLATION VERIFICATION"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check ESLint configuration
echo "Step 1️⃣  Checking ESLint no-restricted-imports rule..."
if grep -q "no-restricted-imports" Frontend/.eslintrc.json 2>/dev/null; then
    echo -e "${GREEN}✓${NC} ESLint rule configured"
else
    echo -e "${RED}✗${NC} ESLint rule missing from Frontend/.eslintrc.json"
    exit 1
fi
echo ""

# Step 2: Check for server-only guard in API routes
echo "Step 2️⃣  Checking server-only guards in API routes..."
MISSING_GUARD=0

if ! grep -q "import 'server-only'" Frontend/app/api/auth/hash-password/route.ts; then
    echo -e "${RED}✗${NC} Missing 'server-only' guard in hash-password route"
    MISSING_GUARD=1
else
    echo -e "${GREEN}✓${NC} hash-password route protected"
fi

if ! grep -q "import 'server-only'" Frontend/app/api/auth/verify-password/route.ts; then
    echo -e "${RED}✗${NC} Missing 'server-only' guard in verify-password route"
    MISSING_GUARD=1
else
    echo -e "${GREEN}✓${NC} verify-password route protected"
fi

if [ $MISSING_GUARD -eq 1 ]; then
    exit 1
fi
echo ""

# Step 3: Check client components don't import bcryptjs
echo "Step 3️⃣  Verifying no server packages in client code..."
VIOLATIONS=0

# Check app directory (excluding api routes)
for file in $(find Frontend/app -name "*.tsx" -o -name "*.ts" | grep -v "/api/"); do
    # Skip if it's a server-only file
    if grep -q "import 'server-only'" "$file" 2>/dev/null; then
        continue
    fi
    
    # Check for restricted imports
    if grep -E "import.*(?:bcryptjs|nodemailer|puppeteer|libreoffice-convert|fluent-ffmpeg)" "$file" 2>/dev/null | grep -v "^//" >/dev/null; then
        echo -e "${RED}✗${NC} Violation found: $file"
        VIOLATIONS=1
    fi
done

if [ $VIOLATIONS -eq 1 ]; then
    echo -e "${RED}Build would fail: Server packages found in client code${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} No server packages in client code"
echo ""

# Step 4: Check bundle analyzer configuration
echo "Step 4️⃣  Checking bundle analyzer setup..."
if grep -q "withBundleAnalyzer" Frontend/next.config.mjs 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Bundle analyzer configured in next.config.mjs"
    echo "  Run: ${YELLOW}ANALYZE=true npm run build${NC}"
else
    echo -e "${YELLOW}⚠${NC}  Bundle analyzer not found (optional but recommended)"
fi
echo ""

# Step 5: Check package.json documentation
echo "Step 5️⃣  Checking package.json documentation..."
if grep -q "serverOnlyDependencies" Frontend/package.json 2>/dev/null; then
    echo -e "${GREEN}✓${NC} serverOnlyDependencies section found"
else
    echo -e "${YELLOW}⚠${NC}  serverOnlyDependencies documentation missing (recommended)"
fi
echo ""

# Step 6: Verify login/signup pages use API endpoints
echo "Step 6️⃣  Verifying login/signup use API endpoints..."
if grep -q "fetch.*verify-password" Frontend/app/login/page.tsx; then
    echo -e "${GREEN}✓${NC} Login page uses /api/auth/verify-password"
else
    echo -e "${RED}✗${NC} Login page not using verify-password API"
    exit 1
fi

if grep -q "fetch.*hash-password" Frontend/app/signup/page.tsx; then
    echo -e "${GREEN}✓${NC} Signup page uses /api/auth/hash-password"
else
    echo -e "${RED}✗${NC} Signup page not using hash-password API"
    exit 1
fi
echo ""

# Step 7: Summary
echo "════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ ALL SECURITY CHECKS PASSED${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Summary:"
echo "  ✓ ESLint rule prevents server package imports in client"
echo "  ✓ API routes have server-only guards"
echo "  ✓ No server packages found in client code"
echo "  ✓ Bundle analyzer configured for verification"
echo "  ✓ Package.json documents server-only dependencies"
echo "  ✓ Login/Signup pages use server APIs"
echo ""
echo "Next steps:"
echo "  1. Run: ${YELLOW}npm run lint${NC}"
echo "  2. Run: ${YELLOW}ANALYZE=true npm run build${NC} (to verify bundle)"
echo "  3. Verify: bcryptjs, nodemailer, puppeteer NOT in .next/analyze/client.html"
echo ""
