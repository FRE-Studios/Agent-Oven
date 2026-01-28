#!/bin/bash
# List all jobs in Agent-Oven scheduler

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

List all jobs in Agent-Oven scheduler.

Options:
    --json              Output raw JSON
    --quiet, -q         Only show job IDs
    -h, --help          Show this help message
EOF
    exit 1
}

FORMAT="table"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            FORMAT="json"
            shift
            ;;
        -q|--quiet)
            FORMAT="quiet"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Check if jobs file exists
if [ ! -f "$JOBS_FILE" ]; then
    echo "No jobs configured."
    exit 0
fi

# Get job count
JOB_COUNT=$(jq '.jobs | length' "$JOBS_FILE")

if [ "$JOB_COUNT" -eq 0 ]; then
    echo "No jobs configured."
    exit 0
fi

case "$FORMAT" in
    json)
        jq '.jobs' "$JOBS_FILE"
        ;;
    quiet)
        jq -r '.jobs[].id' "$JOBS_FILE"
        ;;
    table)
        echo "=== Agent-Oven Jobs ($JOB_COUNT total) ==="
        echo ""
        printf "%-20s %-30s %-10s %-25s %s\n" "ID" "NAME" "TYPE" "SCHEDULE" "LAST RUN"
        printf "%-20s %-30s %-10s %-25s %s\n" "--------------------" "------------------------------" "----------" "-------------------------" "-------------------"

        jq -r '.jobs[] | [.id, .name, .schedule.type, (if .schedule.type == "once" then .schedule.datetime else .schedule.cron end), (.last_run // "never")] | @tsv' "$JOBS_FILE" | \
        while IFS=$'\t' read -r id name type schedule last_run; do
            # Truncate long names
            name="${name:0:28}"
            [ ${#name} -eq 28 ] && name="${name}.."

            printf "%-20s %-30s %-10s %-25s %s\n" "$id" "$name" "$type" "$schedule" "$last_run"
        done

        echo ""

        # Show next scheduled runs for cron jobs
        echo "Next scheduled runs (cron jobs):"
        jq -r '.jobs[] | select(.schedule.type == "cron") | "  \(.id): \(.schedule.cron)"' "$JOBS_FILE"

        # Show pending one-time jobs
        PENDING_ONCE=$(jq '[.jobs[] | select(.schedule.type == "once" and .last_run == null)] | length' "$JOBS_FILE")
        if [ "$PENDING_ONCE" -gt 0 ]; then
            echo ""
            echo "Pending one-time jobs:"
            jq -r '.jobs[] | select(.schedule.type == "once" and .last_run == null) | "  \(.id): \(.schedule.datetime)"' "$JOBS_FILE"
        fi
        ;;
esac
