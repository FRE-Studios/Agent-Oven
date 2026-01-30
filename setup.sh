#!/bin/bash
# Agent-Oven Setup Script
# Installs Colima, Docker, and creates launchd agent for scheduler

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.agent-oven.scheduler.plist"
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

echo "=== Agent-Oven Setup ==="
echo ""

# Check for Homebrew
if ! command -v brew &>/dev/null; then
    echo "ERROR: Homebrew is required but not installed."
    echo "Install it from: https://brew.sh"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
brew install colima docker jq 2>/dev/null || {
    echo "Updating existing installations..."
    brew upgrade colima docker jq 2>/dev/null || true
}

# Start Colima if not running
echo ""
echo "Checking Colima status..."
if ! colima status &>/dev/null; then
    COLIMA_CPU=$(read_colima_config "cpu" "$DEFAULT_COLIMA_CPU")
    COLIMA_MEMORY=$(read_colima_config "memory" "$DEFAULT_COLIMA_MEMORY")
    COLIMA_DISK=$(read_colima_config "disk" "$DEFAULT_COLIMA_DISK")
    echo "Starting Colima (cpu=$COLIMA_CPU, memory=$COLIMA_MEMORY, disk=$COLIMA_DISK)..."
    colima start --cpu "$COLIMA_CPU" --memory "$COLIMA_MEMORY" --disk "$COLIMA_DISK"
else
    echo "Colima is already running."
fi

# Verify Docker works
echo ""
echo "Verifying Docker connection..."
if docker info &>/dev/null; then
    echo "Docker is working."
else
    echo "ERROR: Docker is not responding. Check Colima status."
    exit 1
fi

# Create logs directory
mkdir -p "$SCRIPT_DIR/logs/jobs"

# Create initial jobs.json if it doesn't exist
if [ ! -f "$SCRIPT_DIR/jobs.json" ]; then
    echo '{"jobs": []}' > "$SCRIPT_DIR/jobs.json"
fi

# Build base images
echo ""
echo "Building base task images..."

# Build python-tasks image if Dockerfile exists
if [ -f "$SCRIPT_DIR/images/python-tasks/Dockerfile" ]; then
    echo "Building agent-oven/python-tasks..."
    docker build -t agent-oven/python-tasks "$SCRIPT_DIR/images/python-tasks"
fi

# Build node-tasks image if Dockerfile exists
if [ -f "$SCRIPT_DIR/images/node-tasks/Dockerfile" ]; then
    echo "Building agent-oven/node-tasks..."
    docker build -t agent-oven/node-tasks "$SCRIPT_DIR/images/node-tasks"
fi

# Build base-tasks image if Dockerfile exists
if [ -f "$SCRIPT_DIR/images/base-tasks/Dockerfile" ]; then
    echo "Building agent-oven/base-tasks..."
    docker build -t agent-oven/base-tasks "$SCRIPT_DIR/images/base-tasks"
fi

# Build pipeline-runner image if Dockerfile exists
if [ -f "$SCRIPT_DIR/images/pipeline-runner/Dockerfile" ]; then
    echo "Building agent-oven/pipeline-runner..."
    docker build -t agent-oven/pipeline-runner "$SCRIPT_DIR/images/pipeline-runner"
fi

# Create LaunchAgent directory if needed
mkdir -p "$HOME/Library/LaunchAgents"

# Create launchd plist
echo ""
echo "Creating launchd agent..."
cat > "$LAUNCHD_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-oven.scheduler</string>

    <key>ProgramArguments</key>
    <array>
        <string>${SCRIPT_DIR}/scheduler.sh</string>
    </array>

    <key>StartInterval</key>
    <integer>60</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${SCRIPT_DIR}/logs/scheduler.log</string>

    <key>StandardErrorPath</key>
    <string>${SCRIPT_DIR}/logs/scheduler.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

# Load the launchd agent
echo "Loading launchd agent..."
launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
launchctl load "$LAUNCHD_PLIST"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Colima status:"
colima status
echo ""
echo "Scheduler is now running every 60 seconds."
echo "View scheduler logs: tail -f $SCRIPT_DIR/logs/scheduler.log"
echo ""
echo "Add a test job:"
echo "  $SCRIPT_DIR/add.sh --id test --name 'Test Job' --image alpine --command 'echo Hello from Agent-Oven' --once \"\$(date -v+2M '+%Y-%m-%dT%H:%M:%S')\""
