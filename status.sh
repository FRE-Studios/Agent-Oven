#!/bin/bash
# Show Agent-Oven status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"
LOG_DIR="$SCRIPT_DIR/logs"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.agent-oven.scheduler.plist"

echo "=== Agent-Oven Status ==="
echo ""

# Colima status
echo "--- Colima VM ---"
if colima status &>/dev/null; then
    colima status 2>/dev/null | head -5
    echo ""
    echo "Docker info:"
    docker info 2>/dev/null | grep -E "^(Containers|Running|Paused|Stopped|Images|Server Version):" | sed 's/^/  /'
else
    echo "  Status: NOT RUNNING"
    echo "  Run './setup.sh' or 'colima start' to start"
fi
echo ""

# Scheduler status
echo "--- Scheduler Daemon ---"
if launchctl list 2>/dev/null | grep -q "com.agent-oven.scheduler"; then
    echo "  Status: LOADED"
    LAST_RUN=$(launchctl list com.agent-oven.scheduler 2>/dev/null | grep "LastExitStatus" || echo "")
    if [ -n "$LAST_RUN" ]; then
        echo "  $LAST_RUN"
    fi
else
    echo "  Status: NOT LOADED"
    echo "  Run './setup.sh' to install scheduler"
fi
echo ""

# Jobs summary
echo "--- Jobs Summary ---"
if [ -f "$JOBS_FILE" ]; then
    TOTAL=$(jq '.jobs | length' "$JOBS_FILE")
    ENABLED=$(jq '[.jobs[] | select(.enabled != false)] | length' "$JOBS_FILE")
    CRON=$(jq '[.jobs[] | select(.schedule.type == "cron")] | length' "$JOBS_FILE")
    ONCE_PENDING=$(jq '[.jobs[] | select(.schedule.type == "once" and .last_run == null)] | length' "$JOBS_FILE")

    echo "  Total jobs: $TOTAL"
    echo "  Enabled:    $ENABLED"
    echo "  Cron:       $CRON"
    echo "  One-time pending: $ONCE_PENDING"
else
    echo "  No jobs.json found"
fi
echo ""

# Running containers
echo "--- Running Containers ---"
RUNNING=$(docker ps --filter "name=oven-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}" 2>/dev/null)
if [ -n "$RUNNING" ]; then
    printf "  %-25s %-20s %s\n" "NAME" "STATUS" "IMAGE"
    echo "$RUNNING" | while IFS=$'\t' read -r name status image; do
        printf "  %-25s %-20s %s\n" "$name" "$status" "$image"
    done
else
    echo "  No jobs currently running"
fi
echo ""

# Recent executions
echo "--- Recent Executions (last 5) ---"
if [ -d "$LOG_DIR/jobs" ]; then
    find "$LOG_DIR/jobs" -name "*.log" -type f -mtime -7 2>/dev/null | \
    while read -r log_file; do
        job_id=$(basename "$(dirname "$log_file")")
        timestamp=$(basename "$log_file" .log)
        exit_code=$(grep "Exit Code:" "$log_file" 2>/dev/null | tail -1 | awk '{print $NF}')
        [ -z "$exit_code" ] && exit_code="running"
        echo "  $timestamp $job_id (exit: $exit_code)"
    done | sort -r | head -5

    if [ $(find "$LOG_DIR/jobs" -name "*.log" -type f -mtime -7 2>/dev/null | wc -l) -eq 0 ]; then
        echo "  No recent executions"
    fi
else
    echo "  No job logs found"
fi
echo ""

# Scheduler log tail
echo "--- Scheduler Log (last 5 lines) ---"
if [ -f "$LOG_DIR/scheduler.log" ]; then
    tail -5 "$LOG_DIR/scheduler.log" | sed 's/^/  /'
else
    echo "  No scheduler log found"
fi
