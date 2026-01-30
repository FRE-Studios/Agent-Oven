#!/bin/bash
# Pipeline Runner Entrypoint
# Usage: entrypoint.sh <repo> <branch> <pipeline>

set -euo pipefail

REPO="$1"
BRANCH="${2:-main}"
PIPELINE="$3"

if [ -z "$REPO" ] || [ -z "$PIPELINE" ]; then
    echo "Usage: entrypoint.sh <repo> <branch> <pipeline>"
    echo "  repo     - Git repository URL (e.g., https://github.com/user/repo)"
    echo "  branch   - Branch to check out (default: main)"
    echo "  pipeline - Pipeline name to run"
    exit 1
fi

echo "=== Pipeline Runner ==="
echo "Repo:     $REPO"
echo "Branch:   $BRANCH"
echo "Pipeline: $PIPELINE"
echo ""

# Validate Claude authentication
if [ -d "/root/.claude" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "[auth] Claude credentials found"
else
    echo "[auth] WARNING: No Claude credentials detected"
    echo "  Mount ~/.claude or set ANTHROPIC_API_KEY"
fi

# Validate GitHub authentication
if [ -d "/root/.config/gh" ] || [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
    echo "[auth] GitHub credentials found"
else
    echo "[auth] WARNING: No GitHub credentials detected"
    echo "  Mount ~/.config/gh or set GH_TOKEN/GITHUB_TOKEN"
fi

echo ""

# Clone repository
echo "[clone] Cloning $REPO (branch: $BRANCH)..."
git clone --branch "$BRANCH" --depth 1 "$REPO" /workspace/repo
cd /workspace/repo

echo "[clone] Done"
echo ""

# Run the pipeline
echo "[pipeline] Running: agent-pipeline run $PIPELINE"
echo "---"
agent-pipeline run "$PIPELINE"
EXIT_CODE=$?
echo "---"
echo ""

echo "=== Exit Code: $EXIT_CODE ==="
exit $EXIT_CODE
