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

Three job types, discriminated by `type`: `docker` (default), `agent-pipeline`, and `host`.

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

### Host Jobs (`type: "host"`)

Run a command **directly on the host machine** under the scheduler's user — no
container, no image, no container runtime. Useful for tasks that need host-only
resources (devices, local services, host-installed CLIs) or for deployments
without Docker at all. A host-only tick never starts the container runtime.

```json
{
  "id": "nightly-backup",
  "name": "Nightly Backup",
  "type": "host",
  "command": ["/usr/local/bin/backup.sh", "--incremental"],
  "cwd": "/Users/me/projects/thing",
  "env": { "TARGET": "/Volumes/Backup" },
  "schedule": { "type": "cron", "cron": "0 2 * * *" },
  "resources": { "timeout": 600 },
  "enabled": true
}
```

- `command`: `string | string[]`. An **array** is exec'd argv-style (no shell).
  A **string**, or `"shell": true`, runs through the shell (pipes/globs).
- `cwd`: working directory; relative paths resolve against `config.projectDir`
  (default: `projectDir`).
- `resources.timeout` / legacy `timeout`: seconds before the process is killed
  (foreground runs only — detached runs are not timed, same as Docker).

**⚠️ Security:** host jobs run arbitrary commands with **no isolation**, as the
scheduler's user, with that user's full filesystem and credential access. The
runner never uses `sudo`. Whoever can edit `jobs.json` can run code as this user.

**PATH note:** the daemon runs with a minimal environment, so bare command names
(`node`, `python3`, `git`) may not resolve. The runner prepends common bin dirs
(`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`,
`/sbin`) to `PATH`, but prefer **absolute command paths** to be safe.

> The TUI job form is Docker-only; create and edit host jobs via the CLI
> (`agent-oven add --type host`) or by editing `jobs.json` directly.

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

## Publishing to npm

1. Update `CHANGELOG.md` with new version section
2. Bump version: `npm version <version> --no-git-tag-version`
3. Commit, tag (`v<version>`), and push with `git push origin v<version>`
4. Publish: `npm publish`

`prepublishOnly` runs the build automatically. `files` in package.json controls what's included.

## Development

The codebase uses:
- **TypeScript** with strict mode
- **React 18** + **Ink 5** for the TUI
- **Commander** for CLI subcommands
- **execa** for shell command execution
- **vitest** for testing
- ES modules throughout (`"type": "module"`)
