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
