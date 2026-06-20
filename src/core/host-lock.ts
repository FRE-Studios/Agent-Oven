/**
 * PID lockfiles for host jobs.
 *
 * Host jobs have no container, so the docker-inspect overlap check used for
 * container jobs doesn't apply. Instead each running host job records its PID
 * at logs/run/<jobId>.pid. A subsequent scheduler tick (a brand-new process,
 * launched as often as every 60s) consults the lockfile to decide whether a
 * previous run is still active before starting another one.
 *
 * Detached host jobs outlive the tick that started them, so the lockfile is
 * removed by the detached process itself on completion; stale lockfiles (whose
 * PID is no longer alive) are reaped lazily by isHostJobRunning.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './types.js';
import { getRunDir } from './config.js';

/** Path to a host job's PID lockfile. */
export function getPidFilePath(config: Config, jobId: string): string {
  return path.join(getRunDir(config), `${jobId}.pid`);
}

/** Is a process with this PID currently alive (and signalable by us)? */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without actually sending a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Record the PID of a running host job. No-op if pid is undefined. */
export function writePidFile(config: Config, jobId: string, pid: number | undefined): void {
  if (pid === undefined) return;
  const runDir = getRunDir(config);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(getPidFilePath(config, jobId), String(pid));
  } catch {
    // Best-effort: a missing lockfile only weakens overlap detection.
  }
}

/**
 * Atomically acquire a host job lock.
 *
 * The file is created with `wx`, so concurrent runners cannot both pass the
 * check-then-write window. The scheduler process PID is written first as a
 * short-lived placeholder; the runner updates it to the child PID after spawn.
 */
export function acquirePidFile(config: Config, jobId: string): boolean {
  const runDir = getRunDir(config);
  const pidFile = getPidFilePath(config, jobId);

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number | undefined;
    try {
      fs.mkdirSync(runDir, { recursive: true });
      fd = fs.openSync(pidFile, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return false;
      }

      if (isHostJobRunning(config, jobId)) {
        return false;
      }
      // Stale lock was reaped by isHostJobRunning; retry once.
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  return false;
}

/** Remove a host job's PID lockfile. */
export function removePidFile(config: Config, jobId: string): void {
  try {
    fs.unlinkSync(getPidFilePath(config, jobId));
  } catch {
    // Already gone, or never written.
  }
}

/**
 * Is a host job currently running? Reads its lockfile and checks the PID.
 * A lockfile naming a dead PID is reaped (deleted) and treated as not running.
 */
export function isHostJobRunning(config: Config, jobId: string): boolean {
  const pidFile = getPidFilePath(config, jobId);
  let raw: string;
  try {
    raw = fs.readFileSync(pidFile, 'utf-8');
  } catch {
    return false;
  }

  const pid = parseInt(raw.trim(), 10);
  if (isPidAlive(pid)) {
    return true;
  }

  // Stale lockfile — reap it.
  removePidFile(config, jobId);
  return false;
}
