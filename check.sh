#!/bin/bash
echo "🔍 Running CourtIQ pre-push checks..."

# 1. Node syntax check
node --check app.v3.js
if [ $? -ne 0 ]; then
  echo "❌ Syntax error in app.v3.js — fix before pushing!"
  exit 1
fi
echo "✅ Syntax OK"

# 2. Check for the specific broken pattern — empty quotes '' next to + variable +
if grep -n "onclick=\".*('').*\"" app.v3.js; then
  echo "❌ Found broken onclick with empty quotes '' — use addEventListener instead!"
  exit 1
fi
echo "✅ No broken onclick patterns"

# 3. Check for literal newline in regex
if grep -Pn "/\[.*\n.*\]/" app.v3.js 2>/dev/null; then
  echo "❌ Found regex with literal newline!"
  exit 1
fi
echo "✅ No regex issues"

# 4. Check for duplicate const declarations in same scope
DUPES=$(grep -n "^\s*const total\b" app.v3.js | wc -l)
if [ "$DUPES" -gt 1 ]; then
  echo "❌ Duplicate 'const total' found!"
  grep -n "const total\b" app.v3.js
  exit 1
fi
echo "✅ No duplicate declarations"

# 5. Verify loginWithGoogle is exposed
if ! grep -q "window.loginWithGoogle" app.v3.js; then
  echo "❌ window.loginWithGoogle not exposed!"
  exit 1
fi
echo "✅ loginWithGoogle exposed"

echo ""
echo "✅ All checks passed! Safe to push."
