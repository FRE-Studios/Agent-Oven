## Agent Oven v2: Agent Pipeline Scheduling

### Core Concept

Agent Oven is a macOS-native scheduler that runs **Agent Pipeline** workflows in isolated Docker containers on a schedule. Jobs are pipelines — multi-stage DAGs of AI agents orchestrated by [Agent Pipeline](https://github.com/FRE-Studios/Agent-Pipeline) — triggered by cron, manual invocation, or webhooks.

Authentication is **credential-mount-first**: the host machine's existing `claude login` and `gh auth login` sessions are bind-mounted read-only into containers, eliminating secrets management for the two primary auth surfaces. API keys remain supported as a fallback.

```
┌─────────────────────────────────────────────────────────────┐
│                       Trigger Layer                          │
│   ┌──────────┐  ┌──────────┐  ┌──────────────────────┐      │
│   │   Cron   │  │  Manual  │  │   Webhook / API      │      │
│   └────┬─────┘  └────┬─────┘  └──────────┬───────────┘      │
└────────┼─────────────┼───────────────────┼───────────────────┘
         │             │                   │
         └─────────────┼───────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Oven Scheduler                       │
│   ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│   │ Job Manager │  │ Run Queue   │  │ Auth Health Check│    │
│   └─────────────┘  └─────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Docker Execution Layer                       │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Container: agent-oven/pipeline-runner               │   │
│   │                                                      │   │
│   │  Bind Mounts (read-only):                            │   │
│   │    ~/.claude/     → /root/.claude/                   │   │
│   │    ~/.config/gh/  → /root/.config/gh/                │   │
│   │                                                      │   │
│   │  Bind Mounts (read-write):                           │   │
│   │    workspace/     → /workspace/                      │   │
│   │                                                      │   │
│   │  Execution:                                          │   │
│   │    1. Clone target repo into /workspace              │   │
│   │    2. Run: agent-pipeline run <pipeline-name>        │   │
│   │    3. Stream logs back to Agent Oven                 │   │
│   │    4. Push results (commits/PRs) to remote           │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

### Authentication Model

Agent Oven uses a **credential-mount** strategy by default: the host machine's existing CLI login sessions are bind-mounted into containers at runtime. No secrets are copied, stored, or encrypted — containers read credentials directly from the host filesystem.

#### How It Works

```
macOS host ~/.claude/            ──▶  Container /root/.claude/        (read-only)
macOS host ~/.config/gh/         ──▶  Container /root/.config/gh/     (read-only)
```

Colima mounts `$HOME` into the Linux VM by default. Docker bind mounts then expose **only the specific directories needed** — the container has zero visibility into the rest of the host filesystem.

#### One-Time Host Setup

```bash
# Claude Code — run once on the Mac host
claude login

# GitHub CLI — run once on the Mac host
gh auth login
```

That's it. Every pipeline container inherits both sessions automatically.

#### Auth Modes

| Mode | How it works | When to use |
|------|-------------|-------------|
| `"host-login"` (default) | Mounts `~/.claude/` and `~/.config/gh/` read-only | Single-user Mac, dev machines, Mac Minis |
| `"api-key"` | Injects `ANTHROPIC_API_KEY` / `GITHUB_TOKEN` as env vars | CI/CD, shared servers, headless environments |

Jobs can override the default per-job via the `auth` field. The scheduler auto-injects the appropriate mounts or env vars based on the auth mode.

#### Auth Health Check

Before launching a pipeline run, the scheduler validates credentials:

1. **Claude**: Verify `~/.claude/` exists and contains credential files
2. **GitHub**: Verify `~/.config/gh/hosts.yml` exists and is non-empty
3. **Token expiry**: If a run fails with auth errors (exit code + stderr pattern matching), surface a clear message in the TUI: _"Claude login expired — run `claude login` on host to re-authenticate"_

Failed health checks block job execution and emit a notification rather than launching a doomed container.

#### Security Properties

- **Read-only mounts**: Containers cannot modify host credentials (`:ro` flag)
- **No secret storage**: No encrypted vaults, no key rotation, no secrets in jobs.json
- **Minimal surface**: Only `~/.claude/` and `~/.config/gh/` are mounted — not `$HOME`, not `~/.ssh/`, nothing else
- **Colima isolation**: Containers run inside the Colima Linux VM, adding a layer of separation from macOS

---

### Job Types

Agent Oven supports two job types sharing the same scheduler, trigger, and execution infrastructure.

#### Pipeline Jobs (`type: "agent-pipeline"`)

The primary job type. Runs an Agent Pipeline workflow inside a container.

```json
{
  "id": "nightly-code-review",
  "name": "Nightly Code Review",
  "type": "agent-pipeline",

  "source": {
    "repo": "git@github.com:myorg/myapp.git",
    "branch": "main"
  },

  "pipeline": "post-commit-example",

  "auth": "host-login",

  "schedule": {
    "type": "cron",
    "cron": "0 2 * * *"
  },

  "env": {},

  "notifications": {
    "slack": "#agent-runs",
    "onFailure": true,
    "onSuccess": false
  },

  "resources": {
    "timeout": 1800,
    "memory": "2g",
    "cpus": 2
  },

  "enabled": true
}
```

#### Docker Jobs (`type: "docker"`)

General-purpose container execution for non-pipeline tasks (scripts, cron utilities, data jobs).

```json
{
  "id": "backup-db",
  "name": "Database Backup",
  "type": "docker",

  "image": "agent-oven/base-tasks",
  "command": ["sh", "/scripts/backup.sh"],
  "volumes": ["/host/scripts:/scripts:ro"],
  "env": { "BACKUP_PATH": "/data/backups" },

  "schedule": {
    "type": "cron",
    "cron": "0 4 * * *"
  },

  "resources": {
    "timeout": 600,
    "memory": "512m"
  },

  "enabled": true
}
```

#### Full Job Schema

```typescript
interface Job {
  id: string;                          // unique, alphanumeric + hyphens
  name: string;                        // human-readable display name
  type: "agent-pipeline" | "docker";   // job type

  // Pipeline-specific (type: "agent-pipeline")
  source?: {
    repo: string;                      // git clone URL
    branch?: string;                   // default: "main"
  };
  pipeline?: string;                   // pipeline name in .agent-pipeline/pipelines/
  auth?: "host-login" | "api-key";     // default: "host-login"

  // Docker-specific (type: "docker")
  image?: string;                      // Docker image
  command?: string | string[];         // Container command
  volumes?: string[];                  // Bind mount strings

  // Shared fields
  env?: Record<string, string>;        // Environment variables (also used for api-key auth)
  schedule: CronSchedule | OnceSchedule;
  notifications?: NotificationConfig;
  resources?: {
    timeout?: number;                  // seconds
    memory?: string;                   // e.g., "2g"
    cpus?: number;                     // e.g., 2
  };
  enabled: boolean;
  last_run?: string;                   // ISO 8601 timestamp
}
```

---

### Pipeline Runner Image

A purpose-built Docker image that serves as the execution environment for all `agent-pipeline` jobs.

#### Dockerfile

```dockerfile
FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Agent Pipeline
RUN npm install -g agent-pipeline

# Git config for automated commits
RUN git config --global user.name "Agent Oven" \
    && git config --global user.email "agent-oven@localhost"

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

#### Entrypoint Script

```bash
#!/bin/bash
set -euo pipefail

REPO="$1"
BRANCH="${2:-main}"
PIPELINE="$3"

echo "=== Agent Oven Pipeline Runner ==="
echo "=== Repo: $REPO ==="
echo "=== Branch: $BRANCH ==="
echo "=== Pipeline: $PIPELINE ==="
echo "=== Started: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Validate auth
if [ -f /root/.claude/.credentials.json ] || [ -d /root/.claude ]; then
  echo "=== Auth: Claude login detected ==="
else
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: No Claude credentials found. Run 'claude login' on host or set ANTHROPIC_API_KEY."
    exit 1
  fi
  echo "=== Auth: API key ==="
fi

if [ -f /root/.config/gh/hosts.yml ]; then
  echo "=== Auth: GitHub CLI login detected ==="
else
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "WARN: No GitHub credentials found. Git push/PR operations will fail."
  fi
fi

# Clone
echo "=== Cloning $REPO ($BRANCH) ==="
git clone --branch "$BRANCH" --single-branch --depth=50 "$REPO" /workspace/repo
cd /workspace/repo

# Run pipeline
echo "=== Running pipeline: $PIPELINE ==="
agent-pipeline run "$PIPELINE"

EXIT_CODE=$?
echo "=== Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "=== Exit Code: $EXIT_CODE ==="
exit $EXIT_CODE
```

#### Container Invocation (from Agent Oven)

```bash
docker run --rm \
  --name "oven-nightly-code-review" \
  -v ~/.claude:/root/.claude \
  -v ~/.config/gh:/root/.config/gh:ro \
  --cpus 2 \
  --memory 2g \
  agent-oven/pipeline-runner \
  "git@github.com:myorg/myapp.git" "main" "post-commit-example"
```

---

### New Components

| Component | Purpose | Phase |
|-----------|---------|-------|
| **Pipeline Runner Image** | Docker image with `agent-pipeline`, `claude`, `git`, `gh`, Node 20 | 1 |
| **Auth Mount Manager** | Resolves auth mode per-job, injects bind mounts or env vars into Docker args | 1 |
| **Auth Health Check** | Pre-flight validation of mounted credentials before launching runs | 1 |
| **Extended Job Schema** | `type` field, pipeline-specific fields (`source`, `pipeline`, `auth`) | 2 |
| **Pipeline Executor** | Builds Docker args for pipeline jobs (clone URL, branch, pipeline name as args) | 2 |
| **Run History DB** | SQLite or JSON store tracking runs, status, duration, stage progress, logs | 3 |
| **Webhook Server** | HTTP server exposing `/api/trigger/:jobId` with bearer token auth | 4 |
| **Secrets Vault** _(optional)_ | Encrypted store for third-party API keys beyond Claude/GitHub | Future |

---

### TUI Additions

**Updated Dashboard:**
```
┌─ Agent Oven ──────────────────────────────────────────┐
│                                                        │
│  Pipelines: 4 configured  |  Docker Jobs: 2           │
│  Auth: claude ✓  gh ✓                                  │
│                                                        │
│  Active Run                                            │
│  ─────────────────────────────────────────────────     │
│  ● nightly-code-review    stage 2/4   security-audit   │
│    ├─ code-review       ✓ 45s                          │
│    ├─ security-audit    ◐ running...                   │
│    ├─ doc-updater       ○ pending                      │
│    └─ memory-manager    ○ pending                      │
│                                                        │
│  Next scheduled: pr-review in 2h                       │
│                                                        │
│  [p] Pipelines  [d] Docker Jobs  [l] Logs              │
│  [w] Webhooks   [a] Auth Status  [q] Quit              │
└────────────────────────────────────────────────────────┘
```

**Auth Status Screen:**
```
┌─ Auth Status ─────────────────────────────────────────┐
│                                                        │
│  Credential Mounts (host-login mode)                   │
│  ─────────────────────────────────────────────────     │
│  Claude Code   ~/.claude/              ✓ valid         │
│  GitHub CLI    ~/.config/gh/           ✓ valid         │
│                                                        │
│  Last verified: 3m ago                                 │
│                                                        │
│  To refresh expired credentials:                       │
│    $ claude login                                      │
│    $ gh auth login                                     │
│                                                        │
│  [r] Re-check now  [Esc] Back                          │
└────────────────────────────────────────────────────────┘
```

**Pipeline Creation Form:**
```
┌─ New Pipeline Job ────────────────────────────────────┐
│                                                        │
│  Job ID:       ______________________________          │
│  Name:         ______________________________          │
│                                                        │
│  Source Repo:  ______________________________          │
│  Branch:       main________________________           │
│  Pipeline:     ______________________________          │
│                                                        │
│  Auth:         (●) Host Login  ( ) API Key             │
│                                                        │
│  Schedule:     ______________________________          │
│                (cron expression or "manual")            │
│                                                        │
│  Timeout:      1800______ sec                          │
│  Memory:       2g________                              │
│  CPUs:         2_________                              │
│                                                        │
│  [Enter] Save  [Esc] Cancel                            │
└────────────────────────────────────────────────────────┘
```

**Live Run View:**
```
┌─ Run: nightly-code-review #47 ────────────────────────┐
│                                                        │
│  Status: Running          Started: 2:04 AM             │
│  Repo:   myorg/myapp      Branch:  main                │
│                                                        │
│  Stages                                                │
│  ─────────────────────────────────────────────────     │
│  1. code-review       ✓ completed    45s   sonnet      │
│  2. security-audit    ◐ running...   22s   opus        │
│  3. doc-updater       ○ pending             haiku      │
│  4. memory-manager    ○ pending             sonnet     │
│                                                        │
│  Live Output (security-audit)                          │
│  ─────────────────────────────────────────────────     │
│  Analyzing authentication middleware...                 │
│  Found 3 potential issues in src/auth/...              │
│  > Reviewing JWT validation logic                      │
│                                                        │
│  [f] Follow output  [g/G] Top/Bottom  [Esc] Back       │
└────────────────────────────────────────────────────────┘
```

**Webhook Management:**
```
┌─ Webhooks ────────────────────────────────────────────┐
│                                                        │
│  Server: http://localhost:3847/api                      │
│  Status: ● Running                                     │
│                                                        │
│  Job                     Token          Last Triggered  │
│  ─────────────────────────────────────────────────     │
│  nightly-code-review     ****a3f9       2h ago          │
│  pr-review-on-demand     ****8c2e       never           │
│                                                        │
│  [n] New webhook  [r] Regenerate token  [c] Copy URL   │
│  [Esc] Back                                             │
└────────────────────────────────────────────────────────┘
```

---

### Implementation Phases

#### Phase 1: Pipeline Runner Foundation

Build the container image and auth mount system — the execution core.

- [ ] **Pipeline Runner Dockerfile** — Node 20, git, gh, claude-code, agent-pipeline
- [ ] **Entrypoint script** — clone repo, validate auth, run pipeline, stream output
- [ ] **Build integration** — Add `images/pipeline-runner/` to `setup.sh` build step
- [ ] **Auth Mount Manager** (`src/core/auth.ts`)
  - [ ] Resolve auth mode (`host-login` vs `api-key`) per job
  - [ ] For `host-login`: generate `-v ~/.claude:/root/.claude` and `-v ~/.config/gh:/root/.config/gh:ro` Docker args
  - [ ] For `api-key`: generate `-e ANTHROPIC_API_KEY=... -e GITHUB_TOKEN=...` Docker args
- [ ] **Auth Health Check** (`src/core/auth.ts`)
  - [ ] Pre-flight: verify credential paths exist and are non-empty
  - [ ] Post-failure: pattern-match stderr for auth errors, surface actionable message
- [ ] **Test** — Manual pipeline run via Docker CLI with mounted credentials

#### Phase 2: Job Schema & Pipeline Executor

Extend the job system to support pipeline jobs natively.

- [ ] **Update `types.ts`** — Add `type` field, pipeline-specific fields (`source`, `pipeline`, `auth`), `notifications`, `resources`
- [ ] **Pipeline Executor** (`src/core/docker.ts`)
  - [ ] Branch `runJob()` on `job.type`
  - [ ] For `agent-pipeline`: build Docker args with auth mounts, pass repo/branch/pipeline as entrypoint args
  - [ ] For `docker`: preserve existing execution path
- [ ] **Update `scheduler.ts`** — Handle both job types in schedule matching
- [ ] **Update `scheduler.sh`** — Shell daemon support for pipeline job execution
- [ ] **Update `jobs.ts`** — Validation for pipeline-specific fields (repo URL format, pipeline name)
- [ ] **Log streaming** — `docker attach` or `docker logs -f` to stream pipeline output to log files

#### Phase 3: Run History & Observability

Track pipeline runs with stage-level granularity.

- [ ] **Run History store** (`src/core/history.ts`)
  - [ ] JSON-file-based run records at `logs/runs/<job-id>/<run-id>.json`
  - [ ] Fields: job ID, run ID, start/end time, trigger type, status, stages[], exit code
  - [ ] Stage records: name, model, status, duration, token usage (if available)
- [ ] **Log correlation** — Link run records to log files at `logs/jobs/<job-id>/<timestamp>.log`
- [ ] **Notification system** (`src/core/notifications.ts`)
  - [ ] Desktop notifications via `osascript` (macOS native)
  - [ ] Slack webhook integration (POST to incoming webhook URL)
  - [ ] Filter: `onFailure`, `onSuccess`, `onAuthExpiry`

#### Phase 4: TUI Integration

Wire everything into the interactive terminal UI.

- [ ] **Updated Dashboard** — Show pipelines vs docker jobs, auth status indicator
- [ ] **Auth Status screen** — Display credential mount status, last verification, re-check action
- [ ] **Pipeline creation form** — Guided form for `agent-pipeline` jobs (repo, branch, pipeline, auth mode, schedule, resources)
- [ ] **Live run view** — Stage progress visualization, live output streaming, model-per-stage display
- [ ] **Run history browser** — List past runs, drill into stage details, view logs
- [ ] **Navigation updates** — Add `[a] Auth Status` keybinding to dashboard

#### Phase 5: Webhook Server

HTTP trigger interface for external integrations.

- [ ] **HTTP server** (`src/core/webhook.ts`)
  - [ ] Fastify or Express server on configurable port (default 3847)
  - [ ] `POST /api/trigger/:jobId` — trigger a job run with bearer token auth
  - [ ] `GET /api/status/:runId` — poll run status and stage progress
  - [ ] `GET /api/health` — server health + auth status
- [ ] **Token management** — Generate per-job bearer tokens, store in config
- [ ] **Rate limiting** — Basic per-IP rate limiting
- [ ] **TUI webhook screen** — Token management, URL copy, trigger history
- [ ] **Launchd integration** — Optional: run webhook server as separate launchd agent

---

### Configuration Updates

Updated `~/.config/agent-oven/config.json`:

```json
{
  "projectDir": "/path/to/agent-oven",
  "colima": { "cpu": 2, "memory": 4, "disk": 20 },
  "docker": { "defaultCpus": 2, "defaultMemory": "2g" },
  "timezone": "America/Los_Angeles",

  "auth": {
    "defaultMode": "host-login",
    "claudeCredPath": "~/.claude",
    "ghCredPath": "~/.config/gh"
  },

  "webhook": {
    "enabled": false,
    "port": 3847
  },

  "notifications": {
    "desktop": true,
    "slack": {
      "webhookUrl": ""
    }
  }
}
```

---

### Dependency Changes

Add to `package.json`:

```json
{
  "dependencies": {
    "agent-pipeline": "^latest"
  }
}
```

Note: `agent-pipeline` is installed **both** in the host project (for TUI pipeline discovery/validation) and globally in the Pipeline Runner Docker image (for container execution).

---

### File Changes Summary

New files:
```
src/core/auth.ts              # Auth mount manager + health checks
src/core/history.ts           # Run history store
src/core/notifications.ts     # Desktop + Slack notifications
src/core/webhook.ts           # HTTP trigger server
src/tui/components/AuthStatus.tsx
src/tui/components/PipelineForm.tsx
src/tui/components/RunView.tsx
src/tui/components/RunHistory.tsx
src/tui/components/WebhookManager.tsx
images/pipeline-runner/Dockerfile
images/pipeline-runner/entrypoint.sh
```

Modified files:
```
src/core/types.ts             # Extended Job interface
src/core/docker.ts            # Pipeline executor branch in runJob()
src/core/jobs.ts              # Pipeline job validation
src/core/scheduler.ts         # Both job types in schedule matching
src/core/config.ts            # Auth + webhook config fields
src/tui/App.tsx               # New screens, navigation
src/tui/components/Dashboard.tsx   # Auth indicator, pipeline stats
src/tui/components/JobList.tsx     # Show job type column
scheduler.sh                  # Pipeline job execution in daemon
setup.sh                      # Build pipeline-runner image
package.json                  # Add agent-pipeline dependency
```

---

### Design Decisions

1. **Pipeline Discovery** — The TUI lists available pipelines by running `agent-pipeline list` against a cloned repo (Agent Pipeline already provides this command). Users define pipelines in `.agent-pipeline/pipelines/` within their repos, and Agent Oven surfaces them in the job creation form. No manual name entry needed.

2. **One Pipeline Per Repo** — Each pipeline job targets a single repo. For workflows spanning multiple repos, users create separate pipeline jobs. This keeps the job schema simple and avoids cross-repo dependency management.

3. **Run History & Cost Tracking** — Agent Pipeline already tracks per-stage timing, model usage, and token counts in its `.agent-pipeline/state/runs/` directory. Agent Oven reads this data from the container after execution and merges it with its own run metadata (trigger type, schedule, container resource usage). No custom cost tracking or artifact system — we surface what Agent Pipeline already produces.

4. **Concurrent Runs Allowed** — The scheduler does not queue or serialize pipeline runs. Multiple containers can run simultaneously, each reading `~/.claude/` and `~/.config/gh/` via independent read-only mounts. If concurrent runs hit API rate limits or auth failures, errors are surfaced per-run in the TUI and notification system. No global concurrency lock.
