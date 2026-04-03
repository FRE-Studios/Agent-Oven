# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-04-02

### Fixed

- Cron scheduler reliability — added `mostRecentCronMatch()` helper that scans backwards to find the most recent matching time, preventing both missed executions and double-fires
- Stale node path detection — daemon config auto-regenerates when the node binary path becomes stale (e.g., after `brew upgrade node`)
- Homebrew node path stability — `resolveStableNodePath()` resolves versioned Cellar paths to the stable `/bin/node` symlink, surviving Homebrew upgrades without daemon config regeneration

## [0.2.0] - 2026-03-19

### Added

- Random-window scheduled jobs — new schedule type for randomized execution within a time window
- Auth health warnings — warns when `~/.claude.json` is missing from credential mounts
- Local repo mounting — `source.repo` can now be a local path (`.`, `./...`, or absolute) mounted into the container
- Linux platform support — systemd user service/timer, native Docker, platform adapter abstraction
- Lightweight version checker with semver comparison
- `shouldRunNow` accepts optional `date` parameter for testing
- `--quiet` flag for pipeline runs in non-interactive contexts

### Fixed

- Detached container log capture — `run <id>` now properly captures stdout/stderr from detached containers (single jobs and pipelines)
- Detached launch error handling — early startup failures detected instead of false success
- SSH→HTTPS git URL conversion in Docker containers (no SSH client available)
- Claude Code mount permissions — `~/.claude/` and `~/.claude.json` mounted read-write (required by CC 2.1.52+)
- Timezone-safe `last_run` handling — UTC storage with explicit `Z`, legacy timestamps interpreted correctly
- Colima runtime status detection — reads stderr, uses `colima list --json` for structured resource info
- launchd HOME environment variable — plist now includes HOME, fixing colima fatal error under launchd
- Cron validation hardened — rejects malformed numeric tokens and bad step forms
- Linux systemd unit generation — proper escaping/quoting for paths with spaces and special chars
- Linux init wizard UX — Docker failure text no longer references Colima, correct step numbering
- Timer cleanup on fast fetch failure in update checker
- Dashboard unmount guard prevents setState after unmount

### Changed

- Log filenames use compact `YYYYMMDD-HHMMSS` format in local time (sorts correctly as filenames and strings)
- Documentation updated to reference `agent-oven` as npm package instead of direct GitHub install

## [0.1.0] - 2025-02-16

### Added

- Interactive terminal UI (TUI) built with React/Ink
  - Dashboard with system status and recent executions
  - Job list with filtering, run, toggle, and delete
  - Job form for creating and editing Docker and pipeline jobs
  - Log viewer with syntax highlighting and follow mode
- Full CLI with Commander (`agent-oven list`, `run`, `add`, `logs`, etc.)
- Docker job scheduling via cron expressions or one-time datetimes
- Agent Pipeline job support (Claude Code pipelines from git repos)
- macOS launchd daemon integration (60-second tick interval)
- Interactive setup wizard (`agent-oven init`)
  - Colima/Docker installation and configuration
  - Pre-built Docker image building
  - Launchd daemon installation
- Pre-built Docker images: base-tasks, python-tasks, node-tasks, pipeline-runner
- TypeScript scheduler daemon (`agent-oven scheduler-tick`)
- XDG-compliant configuration at `~/.config/agent-oven/config.json`
- Core library exportable via `import { ... } from 'agent-oven'`
