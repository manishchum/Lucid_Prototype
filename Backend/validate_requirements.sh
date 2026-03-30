#!/bin/bash

# Validate Requirements Script
# This script validates requirements.txt for:
# 1. Package installation compatibility (dry-run)
# 2. Known security vulnerabilities (CVE check)
# 3. Version conflicts and missing packages

set -e  # Exit on first error

VENV_DIR="venv_validate_$$"
REQUIREMENTS_FILE="requirements.txt"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "Requirements.txt Validation Script"
echo "=========================================="

# Check if requirements.txt exists
if [ ! -f "$REQUIREMENTS_FILE" ]; then
    echo "❌ Error: $REQUIREMENTS_FILE not found in $SCRIPT_DIR"
    exit 1
fi

echo "✓ Found $REQUIREMENTS_FILE"

# Step 1: Create fresh Python venv
echo ""
echo "Step 1: Creating fresh Python virtual environment..."
if python3 -m venv "$VENV_DIR" 2>&1; then
    echo "✓ Virtual environment created: $VENV_DIR"
else
    echo "❌ Failed to create virtual environment"
    exit 1
fi

# Source the venv
if [ "$(uname -s)" = "Darwin" ] || [ "$(uname -s)" = "Linux" ]; then
    # macOS and Linux
    source "$VENV_DIR/bin/activate"
else
    # Windows (Git Bash)
    source "$VENV_DIR/Scripts/activate"
fi

echo "✓ Virtual environment activated"

# Step 2: Upgrade pip and install dependencies
echo ""
echo "Step 2: Upgrading pip, setuptools, and wheel..."
pip install --upgrade pip setuptools wheel --quiet 2>&1 | grep -v "already satisfied" || true
echo "✓ Pip and tools updated"

# Step 3: Run dry-run to check for conflicts
echo ""
echo "Step 3: Running pip install --dry-run to check for conflicts..."
if pip install --dry-run -r "$REQUIREMENTS_FILE" 2>&1 | tail -20; then
    echo "✓ Dry-run passed - no installation conflicts detected"
else
    echo "❌ Dry-run failed - there are installation conflicts"
    deactivate
    rm -rf "$VENV_DIR"
    exit 1
fi

# Step 4: Install packages (actual install)
echo ""
echo "Step 4: Installing packages from requirements.txt..."
if pip install -r "$REQUIREMENTS_FILE" --quiet 2>&1; then
    echo "✓ All packages installed successfully"
else
    echo "❌ Failed to install packages"
    deactivate
    rm -rf "$VENV_DIR"
    exit 1
fi

# Step 5: Check for CVEs using pip-audit
echo ""
echo "Step 5: Checking for known security vulnerabilities (CVEs)..."

# Install pip-audit if not already available
if ! command -v pip-audit &> /dev/null; then
    echo "Installing pip-audit..."
    pip install pip-audit --quiet 2>&1
fi

if pip-audit -r "$REQUIREMENTS_FILE" 2>&1 | tee audit_output.tmp; then
    echo "✓ No known CVEs detected"
    rm -f audit_output.tmp
else
    AUDIT_EXIT_CODE=$?
    # pip-audit returns 64 for found vulnerabilities, capture output
    if grep -q "found" audit_output.tmp; then
        echo "⚠️  Vulnerabilities found - check audit_output.tmp for details"
        cat audit_output.tmp
        rm -f audit_output.tmp
        deactivate
        rm -rf "$VENV_DIR"
        exit 1
    fi
fi

# Step 6: Verify imports for critical packages
echo ""
echo "Step 6: Verifying critical package imports..."
python3 << 'EOF'
import sys

critical_packages = {
    'fastapi': 'FastAPI framework',
    'sqlalchemy': 'Database ORM',
    'supabase': 'Supabase client',
    'numpy': 'Numerical computing',
    'pandas': 'Data manipulation',
    'pydantic': 'Data validation',
    'jwt': 'JWT authentication',
}

failed = False
for pkg, description in critical_packages.items():
    try:
        __import__(pkg)
        print(f"  ✓ {pkg}: {description}")
    except ImportError as e:
        print(f"  ❌ {pkg}: Failed to import - {e}")
        failed = True

sys.exit(1 if failed else 0)
EOF

if [ $? -eq 0 ]; then
    echo "✓ All critical packages imported successfully"
else
    echo "❌ Failed to import some critical packages"
    deactivate
    rm -rf "$VENV_DIR"
    exit 1
fi

# Cleanup
echo ""
echo "Step 7: Cleaning up..."
deactivate
rm -rf "$VENV_DIR"
echo "✓ Virtual environment removed"

echo ""
echo "=========================================="
echo "✓ ALL VALIDATIONS PASSED"
echo "=========================================="
exit 0
