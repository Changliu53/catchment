#!/usr/bin/env bash
# One-time repo setup and push. Read it before running it.
#
# It initialises git in THIS folder, commits everything not covered by
# .gitignore, and pushes to the remote named below. Nothing else is touched.
set -euo pipefail

REMOTE="https://github.com/Changliu53/catchment.git"

cd "$(dirname "$0")/.."
echo "working directory : $(pwd)"
echo "remote            : $REMOTE"
echo
read -r -p "Push this folder to that remote? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "aborted"; exit 1; }

[ -d .git ] || git init -q
git add -A

echo
echo "files that will be committed:"
git diff --cached --name-only | sed 's/^/  /'
echo

git commit -q -F COMMIT_MSG.txt || echo "(nothing new to commit)"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git push -u origin main

echo
echo "done. verify at https://github.com/Changliu53/catchment"
