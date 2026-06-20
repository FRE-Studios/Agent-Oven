# Add a `host` Job Type

## Status

**Implemented** (2026-06-20). Open questions were resolved per the recommended
options below:

- **Runner module layout:** Option A — shared helpers extracted to
  `src/core/run-utils.ts`; host runner in `src/core/host-runner.ts`.
- **`shell` default:** direct-exec-by-default; opt-in `shell: true`. A string
  `command` runs through the shell.
- **Lockfile location:** `logs/run/<id>.pid`, with helpers in a dedicated
  `src/core/host-lock.ts` (so `scheduler-runner.ts` and `host-runner.ts` share
  the lifecycle).

Two items added beyond the original plan:

1. **TUI edit guard.** `JobForm` is Docker-only and would corrupt a host job if
   `[e] Edit` were pressed in `JobDetail`. `JobDetail` now blocks editing host
   jobs with a "edit via jobs.json" message.
2. **Detached lockfile lifecycle.** Detached host runs record the detached
   process PID via an `onSpawn` hook and remove their own lockfile via a
   `cleanupCommand` appended to the detached script; stale lockfiles (dead PID)
   are reaped lazily by `isHostJobRunning`.

## Summary

Agent Oven runs two kinds of jobs today: `docker` (a container) and
`agent-pipeline` (a container running the pipeline-runner image). Both execute
inside Docker. This plan adds a third job type, **`host`**, that runs a command
**directly on the host machine** under the scheduler's user — no container, no
image, no container runtime required.

This is a small, self-contained extension of the existing job model. It reuses
the scheduler, the schedule types, the logging format, the CLI, and the TUI.
The only genuinely new code is a host command runner and a non-container
"is this already running?" check.

## Motivation

Containers are the right default, but some jobs cannot or should not run inside
one:

- **Tasks that need host-only resources** — a local GUI application, a USB or
  serial device, a host service socket, a hardware sensor, a host-installed CLI
  that is impractical to containerize.
- **Tasks that talk to a local service** the host already runs, where a
  container-to-host network hop adds fragility.
- **Lightweight maintenance** — a backup script, a log-rotation helper, a
  health probe — where spinning up a container is disproportionate.
- **Environments without Docker at all** — a user who only wants scheduled host
  commands should not be forced to install and run a container runtime.

The job model, scheduler, and tooling already generalize over a discriminated
union of job types. Adding `host` is mostly "teach each existing branch about a
third case."

## Goals

- A `host` job type that runs `command` on the host with configurable working
  directory, environment, and timeout.
- Identical scheduling semantics (`cron`, `once`, `random-window`), identical
  log file format, identical CLI/TUI surfacing of status and history.
- Host-only deployments work **without a container runtime installed**.
- No behavior change for existing `docker` / `agent-pipeline` jobs, including
  legacy untyped jobs.

## Non-goals

- Sandboxing or resource-limiting host jobs (no cgroups/cpu/memory caps — those
  are container features). Documented as a deliberate limitation.
- A TUI form for creating host jobs in v1 (CLI + `jobs.json` only; the form
  stays Docker-only). A follow-up can add it.
- Cross-platform shell normalization beyond what `execa` already provides.

## Design Overview

A `host` job is `BaseJob` plus a command to execute:

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

Field semantics:

| Field | Meaning |
|---|---|
| `type` | Literal `"host"` (the discriminant). |
| `command` | `string \| string[]`. Array form is exec'd argv-style (no shell). String form may be run via a shell (see `shell`). |
| `cwd` | Optional working directory. Relative paths resolve against `config.projectDir`. Defaults to `config.projectDir`. |
| `env` | Optional env vars merged over the runner's base environment (see "Environment & PATH"). |
| `shell` | Optional `boolean`. When true (or when `command` is a string containing shell syntax), run through the user's shell. Default false → direct exec of argv. |
| `resources.timeout` | Seconds before the process is killed. Falls back to legacy top-level `timeout` for parity with `DockerJob`. |
| `schedule`, `enabled`, `notifications`, `last_run` | Identical to other job types (inherited from `BaseJob`). |

### Execution semantics

- **Direct exec by default.** Array `command` runs argv-style via `execa` with no
  shell, avoiding quoting pitfalls. `shell: true` (or a string command) runs
  through a shell for users who want pipes/globs.
- **Working directory** defaults to `config.projectDir`; relative `cwd` resolves
  against it; absolute `cwd` used as-is.
- **Timeout** via `execa`'s `timeout` option (`resources.timeout ?? timeout`),
  same precedence as Docker jobs.
- **Exit code & success** mirror `runDockerJob`: `success = exitCode === 0`.
- **Detached mode** (`options.detach`) supported with the same grace-period
  startup semantics used for detached Docker runs, so `agent-oven run <id> -d`
  and any detached scheduler path behave consistently.
- **Log format is identical** — same `=== Job / Type / Started / Command ===`
  header, streamed stdout+stderr, and `=== Finished / Exit Code ===` footer, in
  the same `logs/jobs/<id>/<timestamp>.log` location. The Log Viewer, `logs`
  command, and recent-execution parsing all work unchanged.

### Environment & PATH (important)

The scheduler runs under launchd/systemd with a **minimal environment**. A host
job that calls `node`, `python3`, `git`, etc. by bare name may fail with
"command not found" even though it works in an interactive shell.

The host runner will therefore build the child environment as:

1. Start from the runner's `process.env`.
2. Prepend common binary locations to `PATH` if missing
   (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`,
   `/usr/sbin`, `/sbin`).
3. Apply `job.env` last (job overrides win).

This is documented prominently, and the recommendation in docs is to use
**absolute command paths** for host jobs to be safe.

### Security considerations (must be documented loudly)

Host jobs run arbitrary commands **with no isolation**, as the scheduler's user,
with that user's full filesystem and credential access. This is a real change in
posture versus container jobs. Mitigations / documentation requirements:

- README + CLAUDE.md call this out explicitly as a power-user feature.
- `jobs.json` is already trusted input; host jobs do not widen the trust
  boundary beyond "whoever can edit jobs.json can run code as this user" — but
  that consequence is now direct and must be stated.
- No implicit privilege escalation: the runner never uses `sudo`.

## Scheduler Integration

Two scheduler-runner concerns need host-aware handling:

### 1. Overlap detection without a container

`scheduler-runner.ts` currently prevents a job from overlapping itself across
ticks via `docker inspect oven-<id>`. Host jobs have no container, so they need
an equivalent guard (launchd may start a new tick every 60s even if a previous
host job is still running, and detached host jobs outlive their tick).

Proposal: a **PID lockfile** per host job at `logs/run/<jobId>.pid`.

- Before running a host job, if the lockfile exists and names a live PID, skip
  with `Skipping job <id>: previous run still active`.
- Write the PID on start; remove it on completion (and on startup, reap stale
  lockfiles whose PID is dead).
- `isJobRunning(jobId)` becomes type-aware: container inspect for
  docker/pipeline jobs, lockfile check for host jobs.

### 2. Don't require a container runtime for host-only ticks

`runSchedulerTick` currently calls `ensureRuntime` **before processing any
job**, which would start the container runtime (e.g. Colima) even when the only
due jobs are host jobs — and would hard-fail on a machine with no Docker at all.

Proposal: compute the set of **due** jobs first, then call `ensureRuntime` only
if at least one due job is container-based (`docker` or `agent-pipeline`). A
deployment with only host jobs never touches Docker. (This also avoids waking
the runtime at 2am for a host-only tick.)

## Detailed Changes

### `src/core/types.ts`

- Add `HostJob extends BaseJob` with `type: 'host'`, `command: string | string[]`,
  `cwd?: string`, `env` (inherited), `shell?: boolean`, `timeout?: number`
  (legacy parity).
- Add `HostJob` to the `Job` union.
- Add `isHostJob(job): job is HostJob`.
- Extend `AddJobOptions` and `UpdateJobOptions` unions to include `HostJob`.

### `src/core/jobs.ts`

- `normalizeJob`: accept `raw.type === 'host'` as a known type (legacy fallback
  to `docker` is unchanged).
- `addJob`: validation branch — host jobs require `command`.
- `validateJob`: host branch — `command` required; reuse existing schedule and
  resources validation.

### Host runner

Two options:

- **Option A (recommended): extract shared run helpers.** Move the
  transport-agnostic helpers out of `docker.ts` into a new
  `src/core/run-utils.ts` — `prepareLogFile`, `shellEscape`, `readLogTail`,
  `closeLogFd`, a generalized `spawnDetachedRun(commandLine, logFile)`, and the
  log header/footer builders. Then `docker.ts` and a new
  `src/core/host-runner.ts` both import them. Cleaner separation; `docker.ts`
  stops being the home of non-Docker logic.
- **Option B (minimal): add `runHostJob` inside `docker.ts`**, reusing the
  existing private helpers. Less churn, but `docker.ts` accretes host logic.

Either way, add `runHostJob(config, job, options)` implementing the execution
semantics above, and update `runJob` routing in `docker.ts`:

```
isPipelineJob → runPipelineJob
isHostJob     → runHostJob      // new
default       → runDockerJob
```

### `src/core/scheduler-runner.ts`

- Make `isJobRunning` type-aware (container inspect vs. lockfile).
- Add lockfile lifecycle around host job execution.
- Gate `ensureRuntime` on the presence of a due container job.

### CLI

- `src/cli/commands/add.ts`: accept `--type host`, plus `--command`, `--cwd`,
  `--shell`; validate required fields for host.
- `src/cli/commands/show.ts`: render host fields under an `isHostJob` branch
  (Command, Cwd, Timeout).
- `src/cli/commands/list.ts`, `delete.ts`: already print `job.type` generically
  — verify they read correctly for host (no image assumption). No change
  expected.
- `src/cli/commands/run.ts`: uses `runJob`; works once routing lands. No change
  expected.

### TUI

- `src/tui/components/JobDetail.tsx`: add an `isHostJob` render branch (Command,
  Cwd, Timeout), mirroring the existing Docker/Pipeline branches.
- `src/tui/components/JobList.tsx`: prints type generically; verify host rows
  render. No change expected.
- `src/tui/components/JobForm.tsx`: **out of scope for v1** — it explicitly
  creates Docker jobs only. Host jobs are created via CLI / `jobs.json`.
  Documented as a known gap with a follow-up.

### Docs

- `CLAUDE.md` and `README.md`: add `host` to the Job JSON structure section,
  with the security note and the PATH/absolute-path guidance.

## Testing Plan

- `src/core/__tests__/types.test.ts`: `isHostJob` true/false + mutual exclusion
  with the other guards.
- `src/core/__tests__/jobs.test.ts`: add/validate host jobs (missing `command`
  rejected; valid host job round-trips through read/normalize/write).
- `src/core/__tests__/fixtures.ts`: add a `hostJob` fixture.
- New `host-runner.test.ts`: mock `execa`; assert cwd/env/PATH merge, timeout
  wiring, success/failure exit-code mapping, and log header/footer format.
- `docker.test.ts`: assert `runJob` routes `type: host` to the host runner.
- Scheduler: lockfile skip path (live PID skips; stale PID reaped); `ensureRuntime`
  not called for a host-only due set.

## Backward Compatibility

- Legacy untyped jobs still normalize to `docker` (unchanged).
- Existing `docker` / `agent-pipeline` jobs are untouched.
- The `host` type is purely additive; `jobs.json` files without host jobs behave
  identically.

## Files to Create / Modify

| File | Change |
|---|---|
| `src/core/types.ts` | Add `HostJob`, union member, `isHostJob`, options unions |
| `src/core/jobs.ts` | Normalize/validate/add host jobs |
| `src/core/run-utils.ts` *(new, Option A)* | Shared run helpers extracted from `docker.ts` |
| `src/core/host-runner.ts` *(new)* | `runHostJob` implementation |
| `src/core/docker.ts` | `runJob` routing → host; (Option A) import shared helpers |
| `src/core/scheduler-runner.ts` | Type-aware overlap check + lockfile; conditional `ensureRuntime` |
| `src/cli/commands/add.ts` | `--type host` and host flags |
| `src/cli/commands/show.ts` | Host detail rendering |
| `src/tui/components/JobDetail.tsx` | Host detail rendering |
| `src/core/__tests__/*` | New/updated tests + fixture |
| `CLAUDE.md`, `README.md` | Document host job type + security note |

## Phased Rollout

1. **Types + core** — `HostJob`, guards, `jobs.ts`, host runner, routing. Unit
   tests green, `npm run typecheck` clean.
2. **Scheduler integration** — lockfile overlap guard + conditional runtime.
3. **Surfaces** — CLI `add`/`show`, TUI `JobDetail`, docs.
4. **(Optional follow-up)** — host support in the TUI `JobForm`.

## Open Questions

- **`shell` default:** direct-exec-by-default with opt-in `shell` (proposed), or
  infer shell from string vs array `command`?
- **Lockfile location:** `logs/run/<id>.pid` (proposed) vs. a dedicated XDG
  runtime dir.
- **Runner module layout:** Option A (extract `run-utils.ts`) vs. Option B
  (keep in `docker.ts`).
