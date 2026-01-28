#!/bin/bash
# Remove a job from Agent-Oven scheduler

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"

usage() {
    cat << EOF
Usage: $(basename "$0") JOB_ID [OPTIONS]

Remove a job from Agent-Oven scheduler.

Arguments:
    JOB_ID              ID of the job to remove

Options:
    -f, --force         Remove without confirmation
    -h, --help          Show this help message

Examples:
    $(basename "$0") daily-cleanup
    $(basename "$0") backup-jan --force
EOF
    exit 1
}

JOB_ID=""
FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--force)
            FORCE=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            echo "Unknown option: $1"
            usage
            ;;
        *)
            if [ -z "$JOB_ID" ]; then
                JOB_ID="$1"
            else
                echo "Unexpected argument: $1"
                usage
            fi
            shift
            ;;
    esac
done

[ -z "$JOB_ID" ] && { echo "ERROR: Job ID is required"; usage; }

# Check if job exists
if ! jq -e --arg id "$JOB_ID" '.jobs[] | select(.id == $id)' "$JOBS_FILE" &>/dev/null; then
    echo "ERROR: Job with ID '$JOB_ID' not found"
    exit 1
fi

# Show job details
echo "Job to remove:"
jq --arg id "$JOB_ID" '.jobs[] | select(.id == $id)' "$JOBS_FILE"
echo ""

# Confirm removal
if [ "$FORCE" != "true" ]; then
    read -p "Are you sure you want to remove this job? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

# Remove the job
TMP_FILE=$(mktemp)
jq --arg id "$JOB_ID" '.jobs = [.jobs[] | select(.id != $id)]' "$JOBS_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$JOBS_FILE"

echo "Job '$JOB_ID' removed successfully."

# Also stop the container if it's running
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^oven-${JOB_ID}$"; then
    echo "Stopping running container..."
    docker stop "oven-${JOB_ID}" 2>/dev/null || true
fi
