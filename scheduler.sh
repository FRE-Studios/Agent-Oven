#!/bin/bash
# Agent-Oven Scheduler Daemon
# Runs periodically via launchd to check and execute scheduled jobs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"
LOG_DIR="$SCRIPT_DIR/logs"
SCHEDULER_LOG="$LOG_DIR/scheduler.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check if Colima is running, start if needed
ensure_colima() {
    if ! colima status &>/dev/null; then
        log "Colima not running, starting..."
        colima start --cpu 2 --memory 4 --disk 20
        sleep 5
    fi
}

# Parse cron expression and check if it matches current time
# Supports: minute hour day month weekday
# Supports: * for any, specific values, and */n for intervals
cron_matches() {
    local cron_expr="$1"
    local current_min=$(date '+%M' | sed 's/^0//')
    local current_hour=$(date '+%H' | sed 's/^0//')
    local current_day=$(date '+%d' | sed 's/^0//')
    local current_month=$(date '+%m' | sed 's/^0//')
    local current_weekday=$(date '+%u')  # 1=Monday, 7=Sunday

    # Handle empty minute
    [ -z "$current_min" ] && current_min=0
    [ -z "$current_hour" ] && current_hour=0

    # Parse cron fields
    local cron_min=$(echo "$cron_expr" | awk '{print $1}')
    local cron_hour=$(echo "$cron_expr" | awk '{print $2}')
    local cron_day=$(echo "$cron_expr" | awk '{print $3}')
    local cron_month=$(echo "$cron_expr" | awk '{print $4}')
    local cron_weekday=$(echo "$cron_expr" | awk '{print $5}')

    # Check each field
    check_field "$cron_min" "$current_min" || return 1
    check_field "$cron_hour" "$current_hour" || return 1
    check_field "$cron_day" "$current_day" || return 1
    check_field "$cron_month" "$current_month" || return 1
    check_field "$cron_weekday" "$current_weekday" || return 1

    return 0
}

# Check if a single cron field matches the current value
check_field() {
    local field="$1"
    local value="$2"

    # Wildcard matches anything
    [ "$field" = "*" ] && return 0

    # Step values (*/n)
    if [[ "$field" =~ ^\*/([0-9]+)$ ]]; then
        local step="${BASH_REMATCH[1]}"
        [ $((value % step)) -eq 0 ] && return 0
        return 1
    fi

    # Exact match
    [ "$field" -eq "$value" ] 2>/dev/null && return 0

    # Comma-separated values
    if [[ "$field" =~ , ]]; then
        IFS=',' read -ra values <<< "$field"
        for v in "${values[@]}"; do
            [ "$v" -eq "$value" ] 2>/dev/null && return 0
        done
    fi

    # Range (n-m)
    if [[ "$field" =~ ^([0-9]+)-([0-9]+)$ ]]; then
        local start="${BASH_REMATCH[1]}"
        local end="${BASH_REMATCH[2]}"
        [ "$value" -ge "$start" ] && [ "$value" -le "$end" ] && return 0
    fi

    return 1
}

# Check if a one-time job should run
once_should_run() {
    local datetime="$1"
    local last_run="$2"

    # Already run
    [ "$last_run" != "null" ] && [ -n "$last_run" ] && return 1

    # Convert to epoch
    local target_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$datetime" "+%s" 2>/dev/null)
    local now_epoch=$(date "+%s")

    # Check if time has passed
    [ "$now_epoch" -ge "$target_epoch" ] && return 0

    return 1
}

# Run a job in Docker
run_job() {
    local job_id="$1"
    local image="$2"
    local command="$3"
    local volumes="$4"
    local env_vars="$5"
    local timeout="$6"

    local job_log_dir="$LOG_DIR/jobs/$job_id"
    mkdir -p "$job_log_dir"
    local log_file="$job_log_dir/$(date '+%Y%m%d-%H%M%S').log"

    log "Running job: $job_id"

    # Build docker command
    local docker_cmd="docker run --rm --name oven-${job_id}"

    # Add resource limits
    docker_cmd+=" --cpus=1 --memory=512m"

    # Add volumes
    if [ "$volumes" != "null" ] && [ -n "$volumes" ]; then
        while IFS= read -r vol; do
            vol=$(echo "$vol" | tr -d '"')
            [ -n "$vol" ] && docker_cmd+=" -v \"$vol\""
        done <<< "$(echo "$volumes" | jq -r '.[]' 2>/dev/null)"
    fi

    # Add environment variables
    if [ "$env_vars" != "null" ] && [ -n "$env_vars" ]; then
        while IFS= read -r key; do
            local value=$(echo "$env_vars" | jq -r ".[\"$key\"]")
            docker_cmd+=" -e \"$key=$value\""
        done <<< "$(echo "$env_vars" | jq -r 'keys[]' 2>/dev/null)"
    fi

    # Add image and command
    docker_cmd+=" $image"

    # Parse command (can be string or array)
    if echo "$command" | jq -e 'type == "array"' &>/dev/null; then
        local cmd_str=$(echo "$command" | jq -r '.[]' | tr '\n' ' ')
        docker_cmd+=" $cmd_str"
    else
        docker_cmd+=" $command"
    fi

    # Execute with timeout
    log "Executing: $docker_cmd"
    {
        echo "=== Job: $job_id ==="
        echo "=== Started: $(date) ==="
        echo "=== Command: $docker_cmd ==="
        echo ""

        if [ -n "$timeout" ] && [ "$timeout" != "null" ]; then
            timeout "${timeout}s" bash -c "$docker_cmd" 2>&1
        else
            bash -c "$docker_cmd" 2>&1
        fi
        local exit_code=$?

        echo ""
        echo "=== Finished: $(date) ==="
        echo "=== Exit Code: $exit_code ==="

        return $exit_code
    } > "$log_file" 2>&1

    local result=$?

    if [ $result -eq 0 ]; then
        log "Job $job_id completed successfully"
    else
        log "Job $job_id failed with exit code $result"
    fi

    return $result
}

# Update job's last_run timestamp
update_last_run() {
    local job_id="$1"
    local timestamp=$(date '+%Y-%m-%dT%H:%M:%S')

    local tmp_file=$(mktemp)
    jq --arg id "$job_id" --arg ts "$timestamp" \
        '(.jobs[] | select(.id == $id) | .last_run) = $ts' \
        "$JOBS_FILE" > "$tmp_file"
    mv "$tmp_file" "$JOBS_FILE"
}

# Remove a job from jobs.json
remove_job() {
    local job_id="$1"

    local tmp_file=$(mktemp)
    jq --arg id "$job_id" \
        '.jobs = [.jobs[] | select(.id != $id)]' \
        "$JOBS_FILE" > "$tmp_file"
    mv "$tmp_file" "$JOBS_FILE"

    log "Removed completed one-time job: $job_id"
}

# Main scheduler logic
main() {
    log "Scheduler run started"

    # Check jobs file exists
    if [ ! -f "$JOBS_FILE" ]; then
        log "No jobs.json file found"
        exit 0
    fi

    # Check if there are any jobs
    local job_count=$(jq '.jobs | length' "$JOBS_FILE")
    if [ "$job_count" -eq 0 ]; then
        log "No jobs configured"
        exit 0
    fi

    # Ensure Colima is running
    ensure_colima

    # Process each job
    local jobs_to_remove=()

    jq -c '.jobs[]' "$JOBS_FILE" | while read -r job; do
        local job_id=$(echo "$job" | jq -r '.id')
        local image=$(echo "$job" | jq -r '.image')
        local command=$(echo "$job" | jq -c '.command')
        local volumes=$(echo "$job" | jq -c '.volumes // empty')
        local env_vars=$(echo "$job" | jq -c '.env // empty')
        local timeout=$(echo "$job" | jq -r '.timeout // empty')
        local schedule_type=$(echo "$job" | jq -r '.schedule.type')
        local last_run=$(echo "$job" | jq -r '.last_run')
        local enabled=$(echo "$job" | jq -r '.enabled // true')

        # Skip disabled jobs
        if [ "$enabled" = "false" ]; then
            continue
        fi

        local should_run=false

        case "$schedule_type" in
            "once")
                local datetime=$(echo "$job" | jq -r '.schedule.datetime')
                if once_should_run "$datetime" "$last_run"; then
                    should_run=true
                fi
                ;;
            "cron")
                local cron_expr=$(echo "$job" | jq -r '.schedule.cron')
                if cron_matches "$cron_expr"; then
                    should_run=true
                fi
                ;;
            *)
                log "Unknown schedule type: $schedule_type for job $job_id"
                ;;
        esac

        if [ "$should_run" = "true" ]; then
            run_job "$job_id" "$image" "$command" "$volumes" "$env_vars" "$timeout"
            update_last_run "$job_id"

            # Mark one-time jobs for removal
            if [ "$schedule_type" = "once" ]; then
                remove_job "$job_id"
            fi
        fi
    done

    log "Scheduler run completed"
}

# Run main
main
