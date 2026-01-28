#!/bin/bash
# Manually run a job immediately

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"
LOG_DIR="$SCRIPT_DIR/logs"

usage() {
    cat << EOF
Usage: $(basename "$0") JOB_ID [OPTIONS]

Manually run a job immediately, bypassing the schedule.

Arguments:
    JOB_ID              ID of the job to run

Options:
    --detach, -d        Run in background (detached)
    --no-log            Don't save output to log file
    -h, --help          Show this help message

Examples:
    $(basename "$0") daily-cleanup
    $(basename "$0") backup-jan --detach
EOF
    exit 1
}

JOB_ID=""
DETACH=false
NO_LOG=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--detach)
            DETACH=true
            shift
            ;;
        --no-log)
            NO_LOG=true
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
JOB=$(jq -e --arg id "$JOB_ID" '.jobs[] | select(.id == $id)' "$JOBS_FILE" 2>/dev/null)
if [ -z "$JOB" ]; then
    echo "ERROR: Job with ID '$JOB_ID' not found"
    echo ""
    echo "Available jobs:"
    jq -r '.jobs[].id' "$JOBS_FILE" 2>/dev/null | sed 's/^/  /'
    exit 1
fi

# Extract job details
IMAGE=$(echo "$JOB" | jq -r '.image')
COMMAND=$(echo "$JOB" | jq -c '.command')
VOLUMES=$(echo "$JOB" | jq -c '.volumes // []')
ENV_VARS=$(echo "$JOB" | jq -c '.env // {}')
TIMEOUT=$(echo "$JOB" | jq -r '.timeout // 300')
NAME=$(echo "$JOB" | jq -r '.name')

echo "=== Running Job: $JOB_ID ==="
echo "Name: $NAME"
echo "Image: $IMAGE"
echo ""

# Check Colima is running
if ! colima status &>/dev/null; then
    echo "Starting Colima..."
    colima start --cpu 2 --memory 4 --disk 20
    sleep 3
fi

# Build docker command
DOCKER_CMD="docker run --rm --name oven-${JOB_ID}-manual"
DOCKER_CMD+=" --cpus=1 --memory=512m"

# Add volumes
if [ "$VOLUMES" != "[]" ]; then
    while IFS= read -r vol; do
        vol=$(echo "$vol" | tr -d '"')
        [ -n "$vol" ] && DOCKER_CMD+=" -v \"$vol\""
    done <<< "$(echo "$VOLUMES" | jq -r '.[]')"
fi

# Add environment variables
if [ "$ENV_VARS" != "{}" ]; then
    while IFS= read -r key; do
        value=$(echo "$ENV_VARS" | jq -r ".[\"$key\"]")
        DOCKER_CMD+=" -e \"$key=$value\""
    done <<< "$(echo "$ENV_VARS" | jq -r 'keys[]')"
fi

# Add image
DOCKER_CMD+=" $IMAGE"

# Add command
if echo "$COMMAND" | jq -e 'type == "array"' &>/dev/null; then
    CMD_STR=$(echo "$COMMAND" | jq -r '.[]' | tr '\n' ' ')
    DOCKER_CMD+=" $CMD_STR"
else
    DOCKER_CMD+=" $(echo "$COMMAND" | jq -r '.')"
fi

# Setup logging
JOB_LOG_DIR="$LOG_DIR/jobs/$JOB_ID"
mkdir -p "$JOB_LOG_DIR"
LOG_FILE="$JOB_LOG_DIR/$(date '+%Y%m%d-%H%M%S')-manual.log"

echo "Command: $DOCKER_CMD"
echo ""

if [ "$DETACH" = "true" ]; then
    # Run detached
    echo "Running in background..."
    if [ "$NO_LOG" = "true" ]; then
        eval "$DOCKER_CMD" &>/dev/null &
    else
        {
            echo "=== Job: $JOB_ID (manual) ==="
            echo "=== Started: $(date) ==="
            eval "$DOCKER_CMD" 2>&1
            echo ""
            echo "=== Finished: $(date) ==="
            echo "=== Exit Code: $? ==="
        } > "$LOG_FILE" 2>&1 &
        echo "Log: $LOG_FILE"
    fi
    echo "Container: oven-${JOB_ID}-manual"
else
    # Run attached
    if [ "$NO_LOG" = "true" ]; then
        eval "timeout ${TIMEOUT}s $DOCKER_CMD"
        EXIT_CODE=$?
    else
        {
            echo "=== Job: $JOB_ID (manual) ==="
            echo "=== Started: $(date) ==="
            echo "=== Command: $DOCKER_CMD ==="
            echo ""
        } > "$LOG_FILE"

        eval "timeout ${TIMEOUT}s $DOCKER_CMD" 2>&1 | tee -a "$LOG_FILE"
        EXIT_CODE=${PIPESTATUS[0]}

        {
            echo ""
            echo "=== Finished: $(date) ==="
            echo "=== Exit Code: $EXIT_CODE ==="
        } >> "$LOG_FILE"

        echo ""
        echo "Log saved to: $LOG_FILE"
    fi

    echo ""
    if [ $EXIT_CODE -eq 0 ]; then
        echo "Job completed successfully."
    else
        echo "Job failed with exit code: $EXIT_CODE"
    fi
    exit $EXIT_CODE
fi
