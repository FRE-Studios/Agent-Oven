# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Oven is a macOS-native job scheduler that runs Docker containers on a schedule using Colima as the container runtime. It features an interactive terminal UI (TUI) built with React/Ink for job management, and a launchd daemon that executes scheduled jobs.

**Status:** In Development

**Long-term goal:** A shell app for deploying, managing, and updating VM "ovens" where scripts/agents can be scheduled to run.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  TUI (npm start)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │
│  │Dashboard│ │Job List │ │Job Form │ │ Log Viewer  │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                   Core Library                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │  jobs.ts │ │scheduler │ │docker.ts │ │ config.ts │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
        ┌─────────┐                 ┌───────────┐
        │jobs.json│                 │  Docker   │
        └─────────┘                 │ (Colima)  │
                                    └───────────┘

┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│   launchd       │────▶│ scheduler.sh │────▶│   Docker    │
│ (60s interval)  │     │   (daemon)   │     │ (via Colima)│
└─────────────────┘     └──────────────┘     └─────────────┘
```

## Project Structure

```
agent-oven/
├── src/
│   ├── core/                # Core library (no UI dependencies)
│   │   ├── types.ts         # TypeScript interfaces
│   │   ├── config.ts        # Configuration management
│   │   ├── jobs.ts          # Job CRUD operations
│   │   ├── docker.ts        # Docker/Colima execution
│   │   └── scheduler.ts     # Cron parsing, schedule matching
│   │
│   ├── tui/                 # Ink TUI components
│   │   ├── App.tsx          # Main app with navigation
│   │   └── components/      # Dashboard, JobList, JobForm, etc.
│   │
│   └── cli.tsx              # Entry point
│
├── dist/                    # Compiled JavaScript
├── images/                  # Dockerfiles for pre-built images
├── scheduler.sh             # Daemon (called by launchd)
├── setup.sh                 # Initial setup script
├── jobs.json                # Job definitions
├── package.json
└── tsconfig.json
```

## Commands

```bash
# Initial setup (installs Colima, Docker, builds images, creates launchd agent)
./setup.sh

# Run the interactive TUI
npm start

# Development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Type check without building
npm run typecheck
```

## TUI Keyboard Shortcuts

**Dashboard:**
- `j` - Go to Jobs list
- `a` - Add new job
- `l` - View logs
- `q` - Quit

**Job List:**
- `↑/↓` or `j/k` - Navigate
- `Enter` - View job details
- `r` - Run job now
- `Space` - Toggle enabled/disabled
- `d` - Delete job
- `/` - Filter jobs
- `Esc` - Back

**Log Viewer:**
- `↑/↓` - Scroll
- `f` - Toggle follow mode
- `g/G` - Go to top/bottom
- `o` - View older runs
- `Esc` - Back

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

## Configuration

User config stored at `~/.config/agent-oven/config.json` (XDG compliant):

```json
{
  "projectDir": "/path/to/agent-oven",
  "colima": { "cpu": 2, "memory": 4, "disk": 20 },
  "docker": { "defaultCpus": 1, "defaultMemory": "512m" },
  "timezone": "America/Los_Angeles"
}
```

## Logs

- Scheduler log: `logs/scheduler.log`
- Job logs: `logs/jobs/<job-id>/<timestamp>.log`

## Development

The codebase uses:
- **TypeScript** with strict mode
- **React 18** + **Ink 5** for the TUI
- **execa** for shell command execution
- ES modules throughout (`"type": "module"`)
