#!/bin/bash
# DEPRECATED: This bash scheduler is kept for reference only.
# New installs use `agent-oven scheduler-tick` (TypeScript).
# See src/core/scheduler-runner.ts for the current implementation.
#
# Agent-Oven Scheduler Daemon (legacy)
# Runs periodically via launchd to check and execute scheduled jobs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/jobs.json"
LOG_DIR="$SCRIPT_DIR/logs"
SCHEDULER_LOG="$LOG_DIR/scheduler.log"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/agent-oven/config.json"

# Default Colima resources
DEFAULT_COLIMA_CPU=2
DEFAULT_COLIMA_MEMORY=4
DEFAULT_COLIMA_DISK=20

# Read a Colima config value from config.json, falling back to default
read_colima_config() {
    local key="$1"
    local default="$2"

    if [ -f "$CONFIG_FILE" ] && command -v jq &>/dev/null; then
        local value
        value=$(jq -r ".colima.${key} // empty" "$CONFIG_FILE" 2>/dev/null)
        if [ -n "$value" ] && [ "$value" != "null" ]; then
            echo "$value"
            return
        fi
    fi
    echo "$default"
}

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check if Colima is running, start if needed
ensure_colima() {
    if ! colima status &>/dev/null; then
        local cpu memory disk
        cpu=$(read_colima_config "cpu" "$DEFAULT_COLIMA_CPU")
        memory=$(read_colima_config "memory" "$DEFAULT_COLIMA_MEMORY")
        disk=$(read_colima_config "disk" "$DEFAULT_COLIMA_DISK")

        log "Colima not running, starting with cpu=$cpu memory=$memory disk=$disk..."
        colima start --cpu "$cpu" --memory "$memory" --disk "$disk"
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

# Route job execution to the appropriate handler
run_job() {
    local job_id="$1"
    local job_json="$2"

    local job_type=$(echo "$job_json" | jq -r '.type // "docker"')

    case "$job_type" in
        "docker")
            local image=$(echo "$job_json" | jq -r '.image')
            local command=$(echo "$job_json" | jq -c '.command')
            local volumes=$(echo "$job_json" | jq -c '.volumes // empty')
            local env_vars=$(echo "$job_json" | jq -c '.env // empty')
            local timeout=$(echo "$job_json" | jq -r '.resources.timeout // .timeout // empty')
            run_docker_job "$job_id" "$image" "$command" "$volumes" "$env_vars" "$timeout"
            ;;
        "agent-pipeline")
            local repo=$(echo "$job_json" | jq -r '.source.repo')
            local branch=$(echo "$job_json" | jq -r '.source.branch // "main"')
            local pipeline=$(echo "$job_json" | jq -r '.pipeline')
            local timeout=$(echo "$job_json" | jq -r '.resources.timeout // empty')
            local env_vars=$(echo "$job_json" | jq -c '.env // empty')
            run_pipeline_job "$job_id" "$repo" "$branch" "$pipeline" "$timeout" "$env_vars"
            ;;
        *)
            log "Unknown job type: $job_type for job $job_id"
            ;;
    esac
}

# Run a Docker container job
run_docker_job() {
    local job_id="$1"
    local image="$2"
    local command="$3"
    local volumes="$4"
    local env_vars="$5"
    local timeout="$6"

    local job_log_dir="$LOG_DIR/jobs/$job_id"
    mkdir -p "$job_log_dir"
    local log_file="$job_log_dir/$(date '+%Y%m%d-%H%M%S').log"

    log "Running docker job: $job_id"

    # Build docker command as an array to prevent command injection
    local -a docker_args=(run --rm "--name=oven-${job_id}")

    # Add resource limits
    docker_args+=(--cpus=1 --memory=512m)

    # Add volumes
    if [ "$volumes" != "null" ] && [ -n "$volumes" ]; then
        while IFS= read -r vol; do
            [ -n "$vol" ] && docker_args+=(-v "$vol")
        done <<< "$(echo "$volumes" | jq -r '.[]' 2>/dev/null)"
    fi

    # Add environment variables
    if [ "$env_vars" != "null" ] && [ -n "$env_vars" ]; then
        while IFS= read -r key; do
            local value
            value=$(echo "$env_vars" | jq -r --arg k "$key" '.[$k]')
            docker_args+=(-e "${key}=${value}")
        done <<< "$(echo "$env_vars" | jq -r 'keys[]' 2>/dev/null)"
    fi

    # Add image
    docker_args+=("$image")

    # Parse command (can be string or array)
    if echo "$command" | jq -e 'type == "array"' &>/dev/null; then
        while IFS= read -r arg; do
            [ -n "$arg" ] && docker_args+=("$arg")
        done <<< "$(echo "$command" | jq -r '.[]')"
    else
        # String command - let docker handle it
        docker_args+=("$command")
    fi

    # Default timeout: 1 hour for docker jobs
    local effective_timeout="${timeout:-3600}"
    [ "$effective_timeout" = "null" ] && effective_timeout=3600

    # Execute with timeout
    log "Executing: docker ${docker_args[*]}"
    {
        echo "=== Job: $job_id ==="
        echo "=== Type: docker ==="
        echo "=== Started: $(date) ==="
        echo "=== Timeout: ${effective_timeout}s ==="
        echo "=== Command: docker ${docker_args[*]} ==="
        echo ""

        timeout "${effective_timeout}s" docker "${docker_args[@]}" 2>&1
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

# Run an agent pipeline job
run_pipeline_job() {
    local job_id="$1"
    local repo="$2"
    local branch="$3"
    local pipeline="$4"
    local timeout="$5"
    local env_vars="$6"

    local job_log_dir="$LOG_DIR/jobs/$job_id"
    mkdir -p "$job_log_dir"
    local log_file="$job_log_dir/$(date '+%Y%m%d-%H%M%S').log"

    log "Running pipeline job: $job_id (pipeline: $pipeline, repo: $repo)"

    # Build docker command as an array to prevent command injection
    local -a docker_args=(run --rm "--name=oven-${job_id}")

    # Add resource limits (default 2 CPU / 2g for pipelines)
    docker_args+=(--cpus=2 --memory=2g)

    # Mount auth credentials (read-only)
    if [ -d "$HOME/.claude" ]; then
        docker_args+=(-v "$HOME/.claude:/root/.claude:ro")
    fi
    if [ -d "$HOME/.config/gh" ]; then
        docker_args+=(-v "$HOME/.config/gh:/root/.config/gh:ro")
    fi

    # Add environment variables
    if [ "$env_vars" != "null" ] && [ -n "$env_vars" ]; then
        while IFS= read -r key; do
            local value
            value=$(echo "$env_vars" | jq -r --arg k "$key" '.[$k]')
            docker_args+=(-e "${key}=${value}")
        done <<< "$(echo "$env_vars" | jq -r 'keys[]' 2>/dev/null)"
    fi

    # Add image and entrypoint args
    docker_args+=(agent-oven/pipeline-runner "$repo" "$branch" "$pipeline")

    # Default timeout: 30 minutes for pipeline jobs
    local effective_timeout="${timeout:-1800}"
    [ "$effective_timeout" = "null" ] && effective_timeout=1800

    # Execute with timeout
    log "Executing: docker ${docker_args[*]}"
    {
        echo "=== Job: $job_id ==="
        echo "=== Type: agent-pipeline ==="
        echo "=== Pipeline: $pipeline ==="
        echo "=== Repo: $repo ($branch) ==="
        echo "=== Started: $(date) ==="
        echo "=== Timeout: ${effective_timeout}s ==="
        echo "=== Command: docker ${docker_args[*]} ==="
        echo ""

        timeout "${effective_timeout}s" docker "${docker_args[@]}" 2>&1
        local exit_code=$?

        echo ""
        echo "=== Finished: $(date) ==="
        echo "=== Exit Code: $exit_code ==="

        return $exit_code
    } > "$log_file" 2>&1

    local result=$?

    if [ $result -eq 0 ]; then
        log "Pipeline job $job_id completed successfully"
    else
        log "Pipeline job $job_id failed with exit code $result"
    fi

    return $result
}

# Update job's last_run timestamp
update_last_run() {
    local job_id="$1"
    local timestamp
    timestamp=$(date '+%Y-%m-%dT%H:%M:%S')

    local tmp_file
    tmp_file=$(mktemp) || { log "ERROR: Failed to create temp file for update_last_run"; return 1; }

    if ! jq --arg id "$job_id" --arg ts "$timestamp" \
        '(.jobs[] | select(.id == $id) | .last_run) = $ts' \
        "$JOBS_FILE" > "$tmp_file"; then
        log "ERROR: jq failed to update last_run for job $job_id"
        rm -f "$tmp_file"
        return 1
    fi

    # Validate the output is valid JSON before replacing
    if ! jq empty "$tmp_file" 2>/dev/null; then
        log "ERROR: jq produced invalid JSON for update_last_run, aborting"
        rm -f "$tmp_file"
        return 1
    fi

    mv "$tmp_file" "$JOBS_FILE" || { log "ERROR: Failed to write updated jobs.json"; return 1; }
}

# Remove a job from jobs.json
remove_job() {
    local job_id="$1"

    local tmp_file
    tmp_file=$(mktemp) || { log "ERROR: Failed to create temp file for remove_job"; return 1; }

    if ! jq --arg id "$job_id" \
        '.jobs = [.jobs[] | select(.id != $id)]' \
        "$JOBS_FILE" > "$tmp_file"; then
        log "ERROR: jq failed to remove job $job_id"
        rm -f "$tmp_file"
        return 1
    fi

    # Validate the output is valid JSON before replacing
    if ! jq empty "$tmp_file" 2>/dev/null; then
        log "ERROR: jq produced invalid JSON for remove_job, aborting"
        rm -f "$tmp_file"
        return 1
    fi

    mv "$tmp_file" "$JOBS_FILE" || { log "ERROR: Failed to write updated jobs.json"; return 1; }

    log "Removed completed one-time job: $job_id"
}

# Rotate scheduler log if it exceeds 10,000 lines
rotate_scheduler_log() {
    if [ -f "$SCHEDULER_LOG" ]; then
        local line_count
        line_count=$(wc -l < "$SCHEDULER_LOG" 2>/dev/null || echo 0)
        if [ "$line_count" -gt 10000 ]; then
            local tmp_file
            tmp_file=$(mktemp) || return
            tail -5000 "$SCHEDULER_LOG" > "$tmp_file"
            mv "$tmp_file" "$SCHEDULER_LOG"
            log "Rotated scheduler log (was $line_count lines)"
        fi
    fi
}

# Prune job logs older than 90 days
prune_old_job_logs() {
    local job_logs_dir="$LOG_DIR/jobs"
    [ -d "$job_logs_dir" ] || return

    local pruned=0
    while IFS= read -r -d '' old_log; do
        rm -f "$old_log"
        pruned=$((pruned + 1))
    done < <(find "$job_logs_dir" -name "*.log" -mtime +90 -print0 2>/dev/null)

    [ "$pruned" -gt 0 ] && log "Pruned $pruned job log(s) older than 90 days"
}

# Prune Docker system resources (runs once per week)
prune_docker() {
    local marker="$LOG_DIR/.last_docker_prune"
    local now
    now=$(date +%s)

    if [ -f "$marker" ]; then
        local last_prune
        last_prune=$(cat "$marker" 2>/dev/null || echo 0)
        local age=$(( now - last_prune ))
        # 604800 = 7 days in seconds
        [ "$age" -lt 604800 ] && return
    fi

    log "Running weekly Docker system prune"
    docker system prune -f --volumes 2>/dev/null || true
    echo "$now" > "$marker"
}

# Check if a job's container is already running
is_job_running() {
    local job_id="$1"
    docker inspect --format='{{.State.Running}}' "oven-${job_id}" 2>/dev/null | grep -q "true"
}

# Main scheduler logic
main() {
    log "Scheduler run started"

    # Housekeeping
    rotate_scheduler_log
    prune_old_job_logs
    prune_docker

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
            # Skip if this job's container is already running
            if is_job_running "$job_id"; then
                log "Skipping job $job_id: container oven-${job_id} is still running"
                continue
            fi

            run_job "$job_id" "$job"
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
