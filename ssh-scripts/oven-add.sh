#!/bin/bash
# Add Agent-Oven job remotely
# Run this from your MacBook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load configuration
source "$PROJECT_DIR/config.sh"

ssh -p "$MAC_MINI_PORT" "$MAC_MINI_USER@$MAC_MINI_HOST" \
    "$AGENT_OVEN_PROJECT_DIR/add.sh" "$@"
