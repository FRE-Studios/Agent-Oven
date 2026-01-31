# Agent Oven

macOS-native job scheduler that runs Docker containers on a schedule using Colima, with an interactive terminal UI for job management.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  TUI (npm start)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐    │
│  │Dashboard│ │Job List │ │Job Form │ │ Log Viewer  │    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────┘    │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                   Core Library                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐   │
│  │  jobs.ts │ │scheduler │ │docker.ts │ │ config.ts │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘   │
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

## Prerequisites

- macOS
- [Homebrew](https://brew.sh)
- Node.js >= 18

## Quick Start

```bash
git clone https://github.com/FRE-Studios/Agent-Oven.git
cd Agent-Oven
npm install
npm run init   # interactive setup wizard
npm start      # launch the TUI
```

## Setup (Init Wizard)

`npm run init` launches an interactive wizard that walks through the full setup:

1. **Prerequisites check** — verifies Homebrew, Colima, Docker, and jq are installed
2. **Dependency installation** — installs any missing dependencies via Homebrew
3. **Colima VM configuration** — configure CPU, memory, and disk allocation for the VM
4. **Colima start** — starts the Colima VM with the chosen settings
5. **Docker verification** — confirms Docker is reachable through Colima
6. **File setup** — creates `logs/`, `logs/jobs/`, and `jobs.json`
7. **Image selection** — choose which pre-built Docker images to build
8. **Image building** — builds the selected Docker images
9. **Timezone configuration** — detects system timezone with option to override
10. **Launchd daemon installation** — installs the scheduler as a launchd agent (runs every 60 seconds)

Configuration is saved to `~/.config/agent-oven/config.json`.

If any step fails, you can **r**etry, **s**kip, or **q**uit.

## Usage — The TUI

`npm start` launches the interactive terminal UI. Navigate between screens using keyboard shortcuts.

### Dashboard

The landing screen. Displays:

- Colima and scheduler daemon status (running/stopped)
- Job summary: total jobs, cron jobs, pending one-time jobs
- Running containers
- Last 5 job executions with status

Auto-refreshes every 10 seconds.

### Job List

Lists all jobs with their ID, enabled status, and schedule type.

- `●` green = enabled
- `○` red = disabled
- `◐` yellow = currently running

Supports filtering by typing `/` and entering a search term. Shows filtered count vs total.

### Job Form

Form for creating or editing Docker jobs. Fields:

| Field | Description |
|-------|-------------|
| ID | Unique identifier (immutable after creation) |
| Name | Human-readable name |
| Image | Docker image (select from built-in images or enter custom) |
| Command | Command to execute in the container |
| Schedule Type | Toggle between `cron` and `once` |
| Cron / Datetime | Cron expression or ISO 8601 datetime |
| Volumes | Volume mounts, one per line (`host:container[:mode]`) |
| Timeout | Timeout in seconds |

### Job Detail

Shows full configuration for a single job:

- Job metadata (name, ID, type, enabled status)
- Docker jobs: image, command, timeout, volumes
- Pipeline jobs: pipeline name, repo, branch, auth mode
- Schedule description and next run time
- Environment variable count
- Last 5 runs with exit codes

### Log Viewer

Displays log file contents with syntax highlighting:

- Error/failed lines in red
- Warning lines in yellow
- Success/exit code 0 in green
- Timestamps dimmed

Auto-refreshes every second when follow mode is enabled. Can switch between multiple log files for a job.

## Keyboard Shortcuts

### Dashboard

| Key | Action |
|-----|--------|
| `j` | Go to Jobs list |
| `a` | Add new job |
| `l` | View scheduler log |
| `q` | Quit |

### Job List

| Key | Action |
|-----|--------|
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `Enter` | View job details |
| `r` | Run job now |
| `Space` | Toggle enabled/disabled |
| `d` | Delete job |
| `a` | Add new job |
| `/` | Filter jobs |
| `Esc` | Back to dashboard |

### Job Detail

| Key | Action |
|-----|--------|
| `r` | Run job now |
| `e` | Edit job |
| `Space` | Toggle enabled/disabled |
| `d` | Delete job |
| `l` | View logs |
| `Esc` | Back |

### Job Form

| Key | Action |
|-----|--------|
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `Ctrl+S` | Save |
| `Space` / `←` / `→` | Toggle schedule type |
| `Esc` | Cancel |

### Log Viewer

| Key | Action |
|-----|--------|
| `↑` / `k` | Scroll up |
| `↓` / `j` | Scroll down |
| `Page Up` | Scroll up one page |
| `Page Down` | Scroll down one page |
| `g` | Go to top |
| `G` | Go to bottom |
| `f` | Toggle follow mode |
| `o` | View older runs |
| `r` | Refresh |
| `Esc` | Back |

### Global

| Key | Action |
|-----|--------|
| `Ctrl+C` | Quit from anywhere |

## Job Configuration

Jobs are stored in `jobs.json`. There are two job types: **Docker** and **Agent Pipeline**.

### Docker Jobs

Run a Docker container with a specified image and command.

```json
{
  "type": "docker",
  "id": "daily-backup",
  "name": "Daily Backup",
  "image": "agent-oven/base-tasks",
  "command": ["sh", "-c", "rsync -av /data/ /backup/"],
  "volumes": ["/Users/me/data:/data:ro", "/Users/me/backup:/backup"],
  "env": { "RETENTION_DAYS": "30" },
  "schedule": { "type": "cron", "cron": "0 2 * * *" },
  "resources": {
    "timeout": 600,
    "memory": "1g",
    "cpus": 1
  },
  "enabled": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"docker"` | yes | Job type discriminator |
| `id` | string | yes | Unique identifier |
| `name` | string | yes | Human-readable name |
| `image` | string | yes | Docker image to run |
| `command` | string or string[] | yes | Command to execute |
| `volumes` | string[] | no | Volume mounts (`host:container[:mode]`) |
| `env` | object | no | Environment variables |
| `schedule` | object | yes | Schedule configuration (see below) |
| `resources` | object | no | Resource limits (timeout, memory, cpus) |
| `timeout` | number | no | Timeout in seconds (legacy, prefer `resources.timeout`) |
| `enabled` | boolean | no | Whether the job is active (default: true) |

### Agent Pipeline Jobs

Run a Claude Code agent pipeline from a git repository.

```json
{
  "type": "agent-pipeline",
  "id": "weekly-review",
  "name": "Weekly Code Review",
  "source": {
    "repo": "https://github.com/user/repo.git",
    "branch": "main"
  },
  "pipeline": "code-review",
  "auth": "host-login",
  "schedule": { "type": "cron", "cron": "0 9 * * 1" },
  "enabled": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"agent-pipeline"` | yes | Job type discriminator |
| `id` | string | yes | Unique identifier |
| `name` | string | yes | Human-readable name |
| `source.repo` | string | yes | Git repository URL |
| `source.branch` | string | no | Branch to check out (default: `"main"`) |
| `pipeline` | string | yes | Pipeline name to run |
| `auth` | `"host-login"` or `"api-key"` | no | Auth mode (defaults to config-level setting) |
| `schedule` | object | yes | Schedule configuration |
| `enabled` | boolean | no | Whether the job is active (default: true) |

### Schedule Types

**Cron** — standard 5-field format: `minute hour day month weekday`

```json
{ "type": "cron", "cron": "0 * * * *" }
```

| Expression | Meaning |
|------------|---------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 9 AM |
| `0 9 * * 1` | Every Monday at 9 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 9-17 * * *` | Every hour from 9 AM to 5 PM |
| `0 0 1,15 * *` | 1st and 15th of each month |

Supported syntax: wildcards (`*`), intervals (`*/5`), ranges (`9-17`), comma-separated values (`1,15,30`). Weekdays: 1=Monday through 7=Sunday.

**One-time** — ISO 8601 datetime, runs once then is removed:

```json
{ "type": "once", "datetime": "2025-03-15T14:30:00" }
```

## Pre-built Docker Images

Built during `npm run init` from the `images/` directory:

| Image | Base | Contents |
|-------|------|----------|
| `agent-oven/base-tasks` | Alpine | bash, curl, wget, jq, yq, git, rsync, tar, gzip, zip, openssh-client, coreutils, findutils, grep, sed, gawk |
| `agent-oven/python-tasks` | Python 3.12 slim | requests, httpx, pandas, numpy, openai, anthropic, langchain, beautifulsoup4, playwright, rich, typer |
| `agent-oven/node-tasks` | Node 20 slim | typescript, tsx, zx, axios, cheerio, puppeteer, playwright, dotenv, commander, chalk |
| `agent-oven/pipeline-runner` | Node 20 slim | @anthropic-ai/claude-code, agent-pipeline, gh (GitHub CLI), git |

All images set `TZ=America/Los_Angeles` and use `/workspace` as the working directory.

## How Scheduling Works

The scheduler runs as a macOS launchd daemon that fires every 60 seconds:

1. **launchd** triggers `scheduler.sh`
2. The script reads `jobs.json` and checks if Colima is running (starts it if needed)
3. For each enabled job, it evaluates the schedule against the current time
4. Matching jobs are executed as Docker containers:
   - **Docker jobs**: run with configured image, command, volumes, env, and resource limits (default: 1 CPU, 512m memory)
   - **Pipeline jobs**: run with `agent-oven/pipeline-runner`, mounting Claude and GitHub credentials read-only (default: 2 CPU, 2g memory, 30 minute timeout)
5. Output is captured to `logs/jobs/<job-id>/<timestamp>.log`
6. `last_run` is updated in `jobs.json`
7. Completed one-time jobs are removed

## Configuration

Stored at `~/.config/agent-oven/config.json`:

```json
{
  "projectDir": "/path/to/agent-oven",
  "colima": {
    "cpu": 2,
    "memory": 4,
    "disk": 20
  },
  "docker": {
    "defaultCpus": 1,
    "defaultMemory": "512m"
  },
  "timezone": "America/Los_Angeles",
  "auth": {
    "defaultMode": "host-login",
    "claudeCredPath": "~/.claude",
    "ghCredPath": "~/.config/gh"
  }
}
```

| Field | Description |
|-------|-------------|
| `projectDir` | Path to the agent-oven project directory |
| `colima.cpu` | Number of CPUs for the Colima VM |
| `colima.memory` | Memory in GB for the Colima VM |
| `colima.disk` | Disk size in GB for the Colima VM |
| `docker.defaultCpus` | Default CPU limit for Docker jobs |
| `docker.defaultMemory` | Default memory limit for Docker jobs |
| `timezone` | Timezone for schedule evaluation |
| `auth.defaultMode` | Default auth mode for pipeline jobs (`host-login` or `api-key`) |
| `auth.claudeCredPath` | Path to Claude credentials directory |
| `auth.ghCredPath` | Path to GitHub CLI credentials directory |

## Logs

**Scheduler log**: `logs/scheduler.log` — records each scheduler run, job matches, and execution results.

**Job logs**: `logs/jobs/<job-id>/<timestamp>.log` — one file per execution, named by timestamp.

View logs through the TUI (press `l` from Dashboard or Job Detail), or read directly from the filesystem.

## Development

```bash
npm run dev        # development mode with hot reload
npm run build      # compile TypeScript to dist/
npm run typecheck  # type check without emitting
```

The codebase uses TypeScript with strict mode, React 18 + Ink 5 for the TUI, execa for shell execution, and ES modules throughout.

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
│   ├── tui/                 # Ink TUI components
│   │   ├── App.tsx          # Main app with navigation
│   │   └── components/      # Dashboard, JobList, JobForm, etc.
│   └── cli.tsx              # Entry point
├── images/                  # Dockerfiles for pre-built images
│   ├── base-tasks/
│   ├── python-tasks/
│   ├── node-tasks/
│   └── pipeline-runner/
├── scheduler.sh             # Daemon script (called by launchd)
├── jobs.json                # Job definitions
├── package.json
└── tsconfig.json
```

## License

MIT
