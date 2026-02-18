# CLAUDE.md

## Project Overview

Agent Oven is a job scheduler that runs Docker containers on a schedule. It features an interactive terminal UI (TUI) built with React/Ink for job management, and a platform-native daemon that executes scheduled jobs.

Supports **macOS** (launchd + Colima) and **Linux** (systemd + native Docker).

**Status:** In Development

**Long-term goal:** A shell app for deploying, managing, and updating VM "ovens" where scripts/agents can be scheduled to run.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  TUI (agent-oven)                        │
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
│                  ┌──────────────┐                        │
│                  │ platform.ts  │ (adapter interface)    │
│                  └──────┬───────┘                        │
│              ┌──────────┴──────────┐                     │
│        ┌─────────────┐   ┌──────────────┐               │
│        │platform-    │   │platform-     │               │
│        │darwin.ts    │   │linux.ts      │               │
│        │(launchd/    │   │(systemd/     │               │
│        │ Colima/brew)│   │ native docker)│              │
│        └─────────────┘   └──────────────┘               │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
agent-oven/
├── src/
│   ├── cli/
│   │   ├── commands/        # CLI subcommands (status, list, add, run, etc.)
│   │   └── utils/           # CLI helpers (errors, output, prompts)
│   ├── core/                # Core library (no UI dependencies)
│   │   ├── __tests__/       # Unit tests
│   │   ├── types.ts         # TypeScript interfaces
│   │   ├── config.ts        # Configuration management
│   │   ├── jobs.ts          # Job CRUD operations
│   │   ├── docker.ts        # Docker execution
│   │   ├── scheduler.ts     # Cron parsing, schedule matching
│   │   ├── scheduler-runner.ts  # Daemon tick orchestration
│   │   ├── platform.ts      # Platform adapter interface + factory
│   │   ├── platform-darwin.ts   # macOS: launchd, Colima, Homebrew
│   │   ├── platform-linux.ts    # Linux: systemd, native Docker
│   │   └── setup.ts         # Setup wizard logic
│   ├── tui/                 # Ink TUI components
│   │   ├── App.tsx          # Main app with navigation
│   │   └── components/      # Dashboard, JobList, JobForm, LogViewer, InitWizard
│   └── cli.tsx              # Entry point (routes to commander or TUI)
├── images/                  # Dockerfiles for pre-built images
├── jobs.json                # Job definitions
├── package.json
└── tsconfig.json
```

## Commands

```bash
# Launch the interactive TUI (default when no args)
npm start                    # or: agent-oven / agent-oven tui

# Interactive setup wizard
npm run init                 # or: agent-oven init

# CLI subcommands
agent-oven status            # System status overview (--json for machine-readable)
agent-oven list              # List all jobs
agent-oven add               # Add a new job
agent-oven show <id>         # Show job details
agent-oven run <id>          # Run a job immediately
agent-oven delete <id>       # Delete a job
agent-oven toggle <id>       # Toggle job enabled/disabled
agent-oven logs [id]         # View job logs
agent-oven daemon status|start|stop|restart  # Manage scheduler daemon
agent-oven up                # Start container runtime + daemon
agent-oven down              # Stop runtime + daemon

# Development
npm run dev                  # Hot reload
npm run build                # Build TypeScript
npm run typecheck            # Type check only
npm test                     # Run tests (vitest)
```

## Platform Support

| | macOS | Linux |
|---|---|---|
| **Daemon** | launchd plist | systemd user service + timer |
| **Runtime** | Colima (Docker VM) | Native Docker |
| **Packages** | Homebrew | Manual install |
| **Scheduler** | `agent-oven scheduler-tick` via launchd | `agent-oven scheduler-tick` via systemd timer |

Platform detection is automatic via `getPlatformAdapter()` in `src/core/platform.ts`.

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

Built during `agent-oven init` from `images/` directory:

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
- **Commander** for CLI subcommands
- **execa** for shell command execution
- **vitest** for testing
- ES modules throughout (`"type": "module"`)
