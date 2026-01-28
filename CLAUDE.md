# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Oven is a macOS-native job scheduler that runs Docker containers on a schedule using Colima as the container runtime. Jobs are defined in `jobs.json` and executed by a launchd daemon that runs every 60 seconds.

**Status:** In Development

**Long-term goal:** A shell app for deploying, managing, and updating VM "ovens" where scripts/agents can be scheduled to run.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│   launchd       │────▶│ scheduler.sh │────▶│   Docker    │
│ (60s interval)  │     │ (reads jobs) │     │ (via Colima)│
└─────────────────┘     └──────────────┘     └─────────────┘
                              │
                              ▼
                        ┌──────────┐
                        │jobs.json │
                        └──────────┘
```

- **scheduler.sh**: Main daemon that parses cron expressions, checks job schedules, and runs Docker containers
- **jobs.json**: Job definitions with schedule (cron or one-time), image, command, volumes, env vars
- **launchd plist**: `~/Library/LaunchAgents/com.agent-oven.scheduler.plist` - starts scheduler every 60 seconds

## Commands

```bash
# Initial setup (installs Colima, Docker, builds images, creates launchd agent)
./setup.sh

# Job management
./add.sh --id <id> --name <name> --image <image> --command <cmd> --cron "* * * * *"
./remove.sh <job-id>
./list.sh [--json | --quiet]

# Execution
./run.sh <job-id> [--detach]

# Monitoring
./status.sh          # Colima, scheduler, jobs, running containers
./logs.sh --scheduler
./logs.sh --job <id> [-f]
```

## Job JSON Structure

```json
{
  "id": "my-job",
  "name": "Human Name",
  "image": "agent-oven/python-tasks",
  "command": ["python", "script.py"],
  "volumes": ["/host/path:/container/path"],
  "env": {"KEY": "value"},
  "schedule": {"type": "cron", "cron": "0 * * * *"},
  "timeout": 300,
  "enabled": true
}
```

## Pre-built Docker Images

Built during `./setup.sh` from `images/` directory:

- **agent-oven/base-tasks**: Alpine with CLI tools (curl, jq, git, rsync, etc.)
- **agent-oven/python-tasks**: Python 3.12 with AI/data libs (openai, anthropic, langchain, pandas)
- **agent-oven/node-tasks**: Node 20 with TypeScript and automation tools (puppeteer, playwright, zx)

## Remote Access

The `ssh-scripts/` directory contains wrappers for running commands on a remote Mac Mini. These expect a `config.sh` with `MAC_MINI_HOST`, `MAC_MINI_PORT`, `MAC_MINI_USER`, and `AGENT_OVEN_PROJECT_DIR` variables.

## Logs

- Scheduler log: `logs/scheduler.log`
- Job logs: `logs/jobs/<job-id>/<timestamp>.log`
