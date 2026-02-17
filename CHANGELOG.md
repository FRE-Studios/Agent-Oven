# Changelog

All notable changes to this project will be documented in this file.

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
