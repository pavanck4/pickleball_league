#!/bin/bash
echo "🔍 Running CourtIQ pre-push checks..."

# 1. Node syntax check
node --check app.v3.js
if [ $? -ne 0 ]; then
  echo "❌ Syntax error in app.v3.js — fix before pushing!"
  exit 1
fi
echo "✅ Syntax OK"

# 2. Check for broken inline onclick with empty string quotes
if grep -n "onclick=\".*('').*\"" app.v3.js; then
  echo "❌ Found broken onclick with empty quotes — use addEventListener instead!"
  exit 1
fi
echo "✅ No broken onclick patterns"

# 3. Check for literal newline in regex
if grep -Pn "/\[.*\n.*\]/" app.v3.js 2>/dev/null; then
  echo "❌ Found regex with literal newline!"
  exit 1
fi
echo "✅ No regex issues"

# 4. Verify loginWithGoogle is exposed
if ! grep -q "window.loginWithGoogle" app.v3.js; then
  echo "❌ window.loginWithGoogle not exposed!"
  exit 1
fi
echo "✅ loginWithGoogle exposed"

# 5. Check browser console for errors using node
node -e "
const fs = require('fs');
const code = fs.readFileSync('app.v3.js', 'utf8');
// Check for the specific broken pattern that node misses but browser catches
const broken = code.match(/onclick=\"[^\"]*''\s*\+/g);
if (broken) {
  console.error('BROKEN ONCLICK:', broken);
  process.exit(1);
}
console.log('No browser-breaking patterns found');
"
if [ $? -ne 0 ]; then
  echo "❌ Browser-breaking pattern found!"
  exit 1
fi
echo "✅ Browser compatibility OK"

echo ""
echo "✅ All checks passed! Safe to push."
