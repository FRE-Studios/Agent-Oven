# Agent Oven Interactive TUI Plan

## Goals
- Replace ad-hoc shell scripts with an interactive terminal UI
- Extensible architecture that separates core logic from presentation
- Open source friendly: no hardcoded paths, configurable, well-documented

## Recommended Approach: Node.js + Ink (React for CLI)

### Why This Stack

| Option | Pros | Cons |
|--------|------|------|
| **Ink (React for CLI)** | Declarative, component-based, familiar React paradigm, npm distribution | Requires Node.js runtime |
| Go + Bubbletea | Single binary, polished TUIs | New language, different ecosystem |
| Python + Textual | Good TUIs, matches python-tasks | Slower startup, packaging complexity |
| Enhanced shell scripts | No new dependencies | Limited interactivity, hard to maintain |

**Ink wins** because: familiar paradigm, fits existing Node ecosystem (node-tasks image), easy npm/npx distribution, excellent for building extensible component-based UIs.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     CLI Entry Point                      │
│                    npx agent-oven                        │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                    TUI Layer (Ink)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │
│  │Dashboard│ │Job List │ │Job Form │ │ Log Viewer  │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                   Core Library                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │JobManager│ │Scheduler │ │DockerExec│ │  Config   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
        ┌─────────┐                 ┌───────────┐
        │jobs.json│                 │  Docker   │
        └─────────┘                 │ (Colima)  │
                                    └───────────┘
```

## Project Structure

```
agent-oven/
├── src/
│   ├── core/                    # Core library (no UI dependencies)
│   │   ├── config.ts            # Configuration management
│   │   ├── jobs.ts              # Job CRUD operations
│   │   ├── scheduler.ts         # Schedule parsing/checking
│   │   ├── docker.ts            # Docker execution
│   │   └── types.ts             # TypeScript interfaces
│   │
│   ├── tui/                     # Ink TUI components
│   │   ├── App.tsx              # Main app with navigation
│   │   ├── components/
│   │   │   ├── Dashboard.tsx    # Status overview
│   │   │   ├── JobList.tsx      # Selectable job list
│   │   │   ├── JobForm.tsx      # Add/edit job form
│   │   │   ├── JobDetail.tsx    # Single job view
│   │   │   ├── LogViewer.tsx    # Scrollable log display
│   │   │   └── common/          # Shared UI components
│   │   └── hooks/
│   │       └── useJobs.ts       # Job state management
│   │
│   └── cli.ts                   # Entry point
│
├── package.json
├── tsconfig.json
├── jobs.json                    # Existing job data
├── scheduler.sh                 # Keep existing (launchd integration)
└── images/                      # Existing Dockerfiles
```

## TUI Screens

### 1. Dashboard (Home)
```
┌─ Agent Oven ──────────────────────────────────────────┐
│                                                        │
│  Status: ● Colima running   ● Scheduler active         │
│                                                        │
│  Jobs: 3 total │ 2 cron │ 1 pending one-time          │
│                                                        │
│  Recent Runs                                           │
│  ─────────────────────────────────────────────────    │
│  ✓ daily-cleanup    2 min ago     exit 0              │
│  ✓ backup-db        1 hour ago    exit 0              │
│  ✗ sync-data        3 hours ago   exit 1              │
│                                                        │
│  [j] Jobs  [a] Add Job  [l] Logs  [s] Settings  [q] Quit│
└────────────────────────────────────────────────────────┘
```

### 2. Job List
```
┌─ Jobs ────────────────────────────────────────────────┐
│                                                        │
│  ▸ daily-cleanup     ● enabled    0 4 * * *           │
│    backup-db         ● enabled    0 */6 * * *         │
│    sync-data         ○ disabled   */30 * * * *        │
│    one-time-task     ◐ pending    2024-02-01 03:00    │
│                                                        │
│  [enter] View  [r] Run now  [e] Edit  [d] Delete      │
│  [space] Toggle  [/] Filter  [esc] Back               │
└────────────────────────────────────────────────────────┘
```

### 3. Add/Edit Job Form
```
┌─ Add Job ─────────────────────────────────────────────┐
│                                                        │
│  ID:        [my-job                    ]              │
│  Name:      [My Scheduled Job          ]              │
│  Image:     [▸ agent-oven/python-tasks ]  (select)    │
│  Command:   [python /scripts/run.py    ]              │
│                                                        │
│  Schedule:  (●) Cron  ( ) One-time                    │
│  Cron:      [0 4 * * *                 ]              │
│             = Every day at 4:00 AM                     │
│                                                        │
│  Volumes:   [+ Add volume]                            │
│    /Users/me/scripts:/scripts:ro                      │
│                                                        │
│  Timeout:   [300] seconds                             │
│                                                        │
│  [tab] Next  [ctrl+s] Save  [esc] Cancel              │
└────────────────────────────────────────────────────────┘
```

### 4. Log Viewer
```
┌─ Logs: daily-cleanup ─────────────────────────────────┐
│                                                        │
│  === Job: daily-cleanup ===                           │
│  === Started: 2024-01-27 04:00:01 ===                 │
│  === Command: docker run --rm ... ===                 │
│                                                        │
│  Cleaning up old log files...                         │
│  Found 12 files older than 7 days                     │
│  Removed: /logs/old-file-1.log                        │
│  Removed: /logs/old-file-2.log                        │
│  ...                                                   │
│  Cleanup complete.                                     │
│                                                        │
│  === Finished: 2024-01-27 04:00:03 ===                │
│  === Exit Code: 0 ===                                 │
│                                                        │
│  [↑/↓] Scroll  [f] Follow  [o] Older runs  [esc] Back │
└────────────────────────────────────────────────────────┘
```

## Configuration

New `~/.config/agent-oven/config.json` (XDG compliant):

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
  "timezone": "America/Los_Angeles"
}
```

Falls back to sensible defaults; auto-detects project directory.

## Implementation Phases

### Phase 1: Core Library
- [ ] `src/core/types.ts` - TypeScript interfaces for Job, Schedule, Config
- [ ] `src/core/config.ts` - Load/save config, find project dir
- [ ] `src/core/jobs.ts` - CRUD operations on jobs.json
- [ ] `src/core/docker.ts` - Run containers, check status, stream logs
- [ ] `src/core/scheduler.ts` - Cron parsing, schedule checking

### Phase 2: Basic TUI
- [ ] Project setup (package.json, tsconfig, Ink dependencies)
- [ ] `src/tui/App.tsx` - Main app with screen navigation
- [ ] `src/tui/components/Dashboard.tsx` - Status overview
- [ ] `src/tui/components/JobList.tsx` - List with selection
- [ ] `src/cli.ts` - Entry point

### Phase 3: Full TUI
- [ ] `src/tui/components/JobForm.tsx` - Add/edit with validation
- [ ] `src/tui/components/JobDetail.tsx` - Single job view with actions
- [ ] `src/tui/components/LogViewer.tsx` - Scrollable, follow mode
- [ ] Keyboard navigation refinement

### Phase 4: Polish & Distribution
- [ ] npm package configuration for `npx agent-oven`
- [ ] Setup command (`agent-oven init`) to replace setup.sh
- [ ] Update CLAUDE.md and README
- [ ] Keep shell scripts as fallback/reference

## Dependencies

```json
{
  "dependencies": {
    "ink": "^4.0.0",
    "ink-select-input": "^5.0.0",
    "ink-text-input": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "react": "^18.0.0",
    "chalk": "^5.0.0",
    "execa": "^8.0.0",
    "conf": "^12.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/react": "^18.0.0",
    "tsx": "^4.0.0"
  }
}
```

## Verification

After each phase:
1. Run `npm run build` to verify TypeScript compiles
2. Run `npx tsx src/cli.ts` to test the TUI
3. Test on Mac Mini via SSH to ensure terminal rendering works
4. Verify existing jobs.json is read correctly

Final verification:
1. Fresh clone can run `npm install && npx agent-oven`
2. Can add, list, run, and view logs for jobs
3. Existing scheduler.sh continues to work (backward compatible)
