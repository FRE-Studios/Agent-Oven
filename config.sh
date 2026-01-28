#!/bin/bash
# Mac Mini Server Configuration
# Edit these values to match your setup

# ===========================================
# VM Direct Connection (Primary - for Pi-hole management)
# ===========================================
VM_HOST="192.168.7.210"         # Ubuntu VM's static IP (bridged networking) FIXME: TODO: NEED TO UPDATE TO ACTUAL STATIC IP
VM_USER="pihole"                # VM username
VM_PORT="22"
REMOTE_PROJECT_DIR="/home/pihole/mac-mini-server"

# ===========================================
# Mac Mini Host (for UTM management)
# ===========================================
MAC_MINI_HOST="192.168.7.225"   # Mac Mini's static IP address
MAC_MINI_USER="mac-mini-server"
MAC_MINI_PORT="22"
MAC_MINI_PROJECT_DIR="/Users/mac-mini-server/mac-mini-server"

# ===========================================
# Agent-Oven (separate repo)
# ===========================================
AGENT_OVEN_PROJECT_DIR="/Users/mac-mini-server/agent-oven"

# ===========================================
# Pi-hole Settings
# ===========================================
PIHOLE_WEB_PORT="80"
PIHOLE_DNS_PORT="53"
TIMEZONE="America/Los_Angeles"

# ===========================================
# Backup Settings
# ===========================================
BACKUP_DIR="./backups"
BACKUP_RETENTION_DAYS=30
