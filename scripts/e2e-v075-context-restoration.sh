#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v075-context-restoration"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e-ux@example.com"
git config user.name "pmem e2e ux"

# 1. Initialize project
"${PMEM[@]}" init my-test --guided --description "React Canvas Game" --stage "Prototype" --next "Build renderer loop" >/dev/null

# Commit initialization files first so HEAD exists
touch README.md
git add .
git commit -m "initial commit" -q

mkdir -p src

# 2. Write App.jsx and App.css
cat > src/App.jsx <<'SRC'
import React, { useEffect } from 'react';
import './App.css';
export default function App() {
  useEffect(() => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    function loop() {
      ctx.clearRect(0, 0, 320, 560);
      ctx.fillText(`Score: ${score}`, 10, 20);
      requestAnimationFrame(loop);
    }
    loop();
  }, []);
  return <canvas id="gameCanvas" width={320} height={560}></canvas>;
}
SRC

cat > src/App.css <<'CSS'
#gameCanvas {
  background: #000;
  width: 320px;
  height: 560px;
}
CSS

# Capture 1 (on uncommitted changed files)
"${PMEM[@]}" capture --auto -s "Create App.jsx and App.css with fixed viewport 320x560" -n "Implement physics"

# Commit them after the capture
git add .
git commit -m "initial files" -q

# Modify App.jsx (Capture 2)
cat > src/App.jsx <<'SRC'
import React, { useEffect } from 'react';
import './App.css';
export default function App() {
  useEffect(() => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    function loop() {
      ctx.clearRect(0, 0, 320, 560);
      ctx.fillText(`Score: ${score}`, 10, 20);
      requestAnimationFrame(loop);
    }
    loop();
  }, []);
  // Decision: Keep fixed mobile viewport 320x560. We decided to use custom physics.
  return <canvas id="gameCanvas" width={320} height={560}></canvas>;
}
SRC
"${PMEM[@]}" capture --auto -s "Added physics comments" -n "Implement collision"
git add .
git commit -m "added physics" -q

# Modify App.jsx (Capture 3)
cat > src/App.jsx <<'SRC'
import React, { useEffect } from 'react';
import './App.css';
export default function App() {
  useEffect(() => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    function loop() {
      ctx.clearRect(0, 0, 320, 560);
      ctx.fillText(`Score: ${score}`, 10, 20);
      requestAnimationFrame(loop);
    }
    loop();
  }, []);
  // Decision: Keep fixed mobile viewport 320x560. We decided to use custom physics.
  // We decided to update score logic on collision.
  return <canvas id="gameCanvas" width={320} height={560}></canvas>;
}
SRC
"${PMEM[@]}" capture --auto -s "Update score logic comments" -n "Implement rendering logic"
git add .
git commit -m "added score logic" -q

# Modify App.jsx (Capture 4)
cat > src/App.jsx <<'SRC'
import React, { useEffect } from 'react';
import './App.css';
export default function App() {
  useEffect(() => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    function loop() {
      ctx.clearRect(0, 0, 320, 560);
      ctx.fillText(`Score: ${score}`, 10, 20);
      requestAnimationFrame(loop);
    }
    // We decided to target requestAnimationFrame.
    loop();
  }, []);
  // Decision: Keep fixed mobile viewport 320x560. We decided to use custom physics.
  // We decided to update score logic on collision.
  return <canvas id="gameCanvas" width={320} height={560}></canvas>;
}
SRC
"${PMEM[@]}" capture --auto -s "Completed basic game layout" -n "Promote inferred cards"
git add .
git commit -m "completed layout" -q

# 3. Infer modules and decisions
"${PMEM[@]}" module infer --write
"${PMEM[@]}" decision infer --write

# Rebuild indexes
"${PMEM[@]}" rebuild

# 4. Verify recall outputs the rich context restoration info
RECALL_OUTPUT=$("${PMEM[@]}" recall)
echo "$RECALL_OUTPUT"

# Assertions
grep -q "320×560" <<< "$RECALL_OUTPUT" || grep -q "320x560" <<< "$RECALL_OUTPUT"
grep -q "requestAnimationFrame" <<< "$RECALL_OUTPUT"
grep -q "score" <<< "$RECALL_OUTPUT" || grep -q "scoring" <<< "$RECALL_OUTPUT"
grep -q "App.jsx" <<< "$RECALL_OUTPUT"
grep -q "App.css" <<< "$RECALL_OUTPUT"
grep -q "module.ui" <<< "$RECALL_OUTPUT"
grep -q "module.engine" <<< "$RECALL_OUTPUT"
grep -q "module.renderer" <<< "$RECALL_OUTPUT"
grep -q "RECENT CHANGES:" <<< "$RECALL_OUTPUT"
grep -q "NEXT:" <<< "$RECALL_OUTPUT"

# 5. Check verify score (all cards should be verified now, so score is 100/100)
VERIFY_OUTPUT=$("${PMEM[@]}" verify)
echo "$VERIFY_OUTPUT"
grep -q "Score: 100/100" <<< "$VERIFY_OUTPUT"

echo "✓ E2E Context Restoration Golden Case passed successfully!"
