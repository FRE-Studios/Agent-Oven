#!/bin/bash
# Add a new job to Agent-Oven scheduler

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"

# Default values
JOB_ID=""
JOB_NAME=""
IMAGE=""
COMMAND=""
VOLUMES=()
ENV_VARS=()
SCHEDULE_TYPE=""
SCHEDULE_VALUE=""
TIMEOUT="300"
NOTIFY_ON_FAILURE="false"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Add a new job to Agent-Oven scheduler.

Required:
    --id ID             Unique job identifier
    --name NAME         Human-readable job name
    --image IMAGE       Docker image to use
    --command CMD       Command to run (quote if contains spaces)

Schedule (one required):
    --once DATETIME     Run once at specified time (format: YYYY-MM-DDTHH:MM:SS)
    --cron EXPR         Run on cron schedule (format: "min hour day month weekday")

Optional:
    --volume VOL        Mount volume (format: /host/path:/container/path[:ro])
                        Can be specified multiple times
    --env KEY=VALUE     Set environment variable
                        Can be specified multiple times
    --timeout SECONDS   Timeout in seconds (default: 300)
    --notify            Enable Discord notification on failure

Examples:
    # One-time backup
    $(basename "$0") \\
        --id backup-jan \\
        --name "January Backup" \\
        --image alpine:latest \\
        --command "tar czf /backup/jan.tar.gz /data" \\
        --volume "/Users/me/important:/data:ro" \\
        --volume "/Users/me/backups:/backup" \\
        --once "2025-02-01T03:00:00"

    # Daily cleanup at 4am
    $(basename "$0") \\
        --id daily-cleanup \\
        --name "Daily Log Cleanup" \\
        --image alpine:latest \\
        --command "find /logs -mtime +7 -delete" \\
        --volume "/var/log:/logs" \\
        --cron "0 4 * * *"
EOF
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --id)
            JOB_ID="$2"
            shift 2
            ;;
        --name)
            JOB_NAME="$2"
            shift 2
            ;;
        --image)
            IMAGE="$2"
            shift 2
            ;;
        --command)
            COMMAND="$2"
            shift 2
            ;;
        --volume)
            VOLUMES+=("$2")
            shift 2
            ;;
        --env)
            ENV_VARS+=("$2")
            shift 2
            ;;
        --once)
            SCHEDULE_TYPE="once"
            SCHEDULE_VALUE="$2"
            shift 2
            ;;
        --cron)
            SCHEDULE_TYPE="cron"
            SCHEDULE_VALUE="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --notify)
            NOTIFY_ON_FAILURE="true"
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

# Validate required fields
[ -z "$JOB_ID" ] && { echo "ERROR: --id is required"; usage; }
[ -z "$JOB_NAME" ] && { echo "ERROR: --name is required"; usage; }
[ -z "$IMAGE" ] && { echo "ERROR: --image is required"; usage; }
[ -z "$COMMAND" ] && { echo "ERROR: --command is required"; usage; }
[ -z "$SCHEDULE_TYPE" ] && { echo "ERROR: --once or --cron is required"; usage; }

# Validate job ID (alphanumeric and hyphens only)
if ! [[ "$JOB_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "ERROR: Job ID must contain only alphanumeric characters, hyphens, and underscores"
    exit 1
fi

# Check for duplicate job ID
if jq -e --arg id "$JOB_ID" '.jobs[] | select(.id == $id)' "$JOBS_FILE" &>/dev/null; then
    echo "ERROR: Job with ID '$JOB_ID' already exists"
    exit 1
fi

# Build volumes JSON array
VOLUMES_JSON="[]"
if [ ${#VOLUMES[@]} -gt 0 ]; then
    VOLUMES_JSON=$(printf '%s\n' "${VOLUMES[@]}" | jq -R . | jq -s .)
fi

# Build env vars JSON object
ENV_JSON="{}"
if [ ${#ENV_VARS[@]} -gt 0 ]; then
    for env in "${ENV_VARS[@]}"; do
        key="${env%%=*}"
        value="${env#*=}"
        ENV_JSON=$(echo "$ENV_JSON" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}')
    done
fi

# Build schedule JSON
if [ "$SCHEDULE_TYPE" = "once" ]; then
    SCHEDULE_JSON=$(jq -n --arg type "once" --arg dt "$SCHEDULE_VALUE" '{type: $type, datetime: $dt}')
else
    SCHEDULE_JSON=$(jq -n --arg type "cron" --arg cron "$SCHEDULE_VALUE" '{type: $type, cron: $cron}')
fi

# Parse command into array if it contains spaces
COMMAND_JSON=$(echo "$COMMAND" | jq -R 'split(" ")')

# Create job JSON
CREATED=$(date '+%Y-%m-%dT%H:%M:%S')
JOB_JSON=$(jq -n \
    --arg id "$JOB_ID" \
    --arg name "$JOB_NAME" \
    --arg image "$IMAGE" \
    --argjson command "$COMMAND_JSON" \
    --argjson volumes "$VOLUMES_JSON" \
    --argjson env "$ENV_JSON" \
    --argjson schedule "$SCHEDULE_JSON" \
    --argjson timeout "$TIMEOUT" \
    --arg created "$CREATED" \
    --argjson notify "$NOTIFY_ON_FAILURE" \
    '{
        id: $id,
        name: $name,
        image: $image,
        command: $command,
        volumes: $volumes,
        env: $env,
        schedule: $schedule,
        timeout: $timeout,
        created: $created,
        last_run: null,
        notify_on_failure: $notify,
        enabled: true
    }')

# Add to jobs.json
TMP_FILE=$(mktemp)
jq --argjson job "$JOB_JSON" '.jobs += [$job]' "$JOBS_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$JOBS_FILE"

echo "Job added successfully:"
echo ""
echo "$JOB_JSON" | jq .
echo ""
echo "View all jobs: $SCRIPT_DIR/list.sh"
echo "Run manually:  $SCRIPT_DIR/run.sh $JOB_ID"
