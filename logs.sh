#!/bin/bash
# View Agent-Oven execution logs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

View Agent-Oven execution logs.

Options:
    --job ID            Show logs for specific job
    --lines N, -n N     Number of lines to show (default: 50)
    --follow, -f        Follow log output (like tail -f)
    --scheduler         Show scheduler daemon logs
    --list              List all available log files
    -h, --help          Show this help message

Examples:
    $(basename "$0") --scheduler              # View scheduler logs
    $(basename "$0") --job daily-cleanup      # View job's latest log
    $(basename "$0") --job daily-cleanup -f   # Follow job's latest log
    $(basename "$0") --list                   # List all log files
EOF
    exit 1
}

JOB_ID=""
LINES=50
FOLLOW=false
SCHEDULER=false
LIST=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --job)
            JOB_ID="$2"
            shift 2
            ;;
        -n|--lines)
            LINES="$2"
            shift 2
            ;;
        -f|--follow)
            FOLLOW=true
            shift
            ;;
        --scheduler)
            SCHEDULER=true
            shift
            ;;
        --list)
            LIST=true
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

# List all logs
if [ "$LIST" = "true" ]; then
    echo "=== Available Logs ==="
    echo ""
    echo "Scheduler log:"
    if [ -f "$LOG_DIR/scheduler.log" ]; then
        echo "  $LOG_DIR/scheduler.log"
    else
        echo "  (none)"
    fi
    echo ""
    echo "Job logs:"
    if [ -d "$LOG_DIR/jobs" ]; then
        for job_dir in "$LOG_DIR/jobs"/*/; do
            if [ -d "$job_dir" ]; then
                job_id=$(basename "$job_dir")
                log_count=$(find "$job_dir" -name "*.log" 2>/dev/null | wc -l | tr -d ' ')
                latest=$(ls -t "$job_dir"/*.log 2>/dev/null | head -1)
                if [ -n "$latest" ]; then
                    echo "  $job_id: $log_count log(s), latest: $(basename "$latest")"
                fi
            fi
        done
    else
        echo "  (none)"
    fi
    exit 0
fi

# Show scheduler logs
if [ "$SCHEDULER" = "true" ]; then
    LOG_FILE="$LOG_DIR/scheduler.log"
    if [ ! -f "$LOG_FILE" ]; then
        echo "No scheduler log found at $LOG_FILE"
        exit 1
    fi

    echo "=== Scheduler Log ==="
    echo ""
    if [ "$FOLLOW" = "true" ]; then
        tail -f "$LOG_FILE"
    else
        tail -n "$LINES" "$LOG_FILE"
    fi
    exit 0
fi

# Show job logs
if [ -n "$JOB_ID" ]; then
    JOB_LOG_DIR="$LOG_DIR/jobs/$JOB_ID"

    if [ ! -d "$JOB_LOG_DIR" ]; then
        echo "No logs found for job '$JOB_ID'"
        echo "Available jobs with logs:"
        ls -1 "$LOG_DIR/jobs" 2>/dev/null || echo "  (none)"
        exit 1
    fi

    # Get latest log file
    LATEST_LOG=$(ls -t "$JOB_LOG_DIR"/*.log 2>/dev/null | head -1)

    if [ -z "$LATEST_LOG" ]; then
        echo "No log files found for job '$JOB_ID'"
        exit 1
    fi

    echo "=== Log: $JOB_ID ==="
    echo "File: $LATEST_LOG"
    echo ""

    if [ "$FOLLOW" = "true" ]; then
        tail -f "$LATEST_LOG"
    else
        tail -n "$LINES" "$LATEST_LOG"
    fi

    # Show older logs if they exist
    LOG_COUNT=$(ls -1 "$JOB_LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
    if [ "$LOG_COUNT" -gt 1 ]; then
        echo ""
        echo "($LOG_COUNT total log files. Use --list to see all.)"
    fi
    exit 0
fi

# Default: show scheduler log
if [ -f "$LOG_DIR/scheduler.log" ]; then
    echo "=== Scheduler Log (last $LINES lines) ==="
    echo ""
    tail -n "$LINES" "$LOG_DIR/scheduler.log"
    echo ""
    echo "Use --job ID to view job-specific logs"
else
    echo "No logs found."
    echo "Run './setup.sh' to initialize Agent-Oven."
fi
