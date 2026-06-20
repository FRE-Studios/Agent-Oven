/**
 * Transport-agnostic helpers shared by the job runners (docker.ts,
 * host-runner.ts). These contain no Docker- or host-specific logic — just
 * log-file preparation, shell escaping, and the detached-spawn machinery.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, JobRunResult } from './types.js';
import { getJobLogsDir } from './config.js';

/** Give detached jobs a brief grace period to surface immediate startup failures. */
export const DETACHED_STARTUP_GRACE_MS = 750;

/**
 * Prepare log file and directory for a job run.
 * Returns the path to a fresh, timestamped log file.
 */
export function prepareLogFile(config: Config, jobId: string): string {
  const jobLogDir = getJobLogsDir(config, jobId);
  if (!fs.existsSync(jobLogDir)) {
    fs.mkdirSync(jobLogDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return path.join(jobLogDir, `${timestamp}.log`);
}

/**
 * Escape a string for safe use as a POSIX shell argument.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function closeLogFd(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Ignore close errors
  }
}

export function readLogTail(logFile: string, maxChars = 4096): string {
  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    if (content.length <= maxChars) {
      return content.trim();
    }
    return content.slice(-maxChars).trim();
  } catch {
    return '';
  }
}

/** Options for a detached run. */
interface DetachedRunOptions {
  /**
   * Invoked synchronously once the child has been spawned, with its PID.
   * Used by callers that need to record the live PID (e.g. a host lockfile).
   */
  onSpawn?: (pid: number | undefined) => void;
  /**
   * A shell command appended after the finish markers are written, so it runs
   * when the detached process completes (e.g. removing a PID lockfile). Because
   * the parent exits immediately, this is the only place such cleanup can run.
   */
  cleanupCommand?: string;
  /** Working directory for the detached shell. */
  cwd?: string;
  /** Environment for the detached shell (replaces the inherited env when set). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn a detached process that streams output to a log file.
 * The parent process can exit immediately; the underlying command continues
 * running with stdout/stderr flowing to the log. When it exits, finish markers
 * and the exit code are appended.
 *
 * `commandLine` must be a complete, shell-ready command string (callers are
 * responsible for shell-escaping argv).
 */
export async function spawnDetachedRun(
  commandLine: string,
  logFile: string,
  options: DetachedRunOptions = {},
): Promise<JobRunResult> {
  const logFd = fs.openSync(logFile, 'a');

  // Run the command in the foreground of a detached shell.
  // After it exits, append finish markers with the exit code, then cleanup.
  const script = [
    commandLine,
    'EC=$?',
    `printf '\\n=== Finished: %s ===\\n=== Exit Code: %d ===\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EC"`,
    ...(options.cleanupCommand ? [options.cleanupCommand] : []),
  ].join('\n');

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn('sh', ['-c', script], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
    });
  } catch (err) {
    closeLogFd(logFd);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      exitCode: 1,
      logFile,
      output: `Failed to start detached job: ${msg}`,
    };
  }

  options.onSpawn?.(child.pid);

  return await new Promise<JobRunResult>((resolve) => {
    let settled = false;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = (result: JobRunResult): void => {
      if (settled) return;
      settled = true;
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      closeLogFd(logFd);
      resolve(result);
    };

    const onError = (err: Error): void => {
      settle({
        success: false,
        exitCode: 1,
        logFile,
        output: `Failed to start detached job: ${err.message}`,
      });
    };

    const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      const code = exitCode ?? 1;
      if (code === 0 && !signal) {
        settle({
          success: true,
          exitCode: 0,
          logFile,
          output: 'Job completed before detaching',
        });
        return;
      }

      const logTail = readLogTail(logFile);
      settle({
        success: false,
        exitCode: code,
        logFile,
        output: logTail || `Detached job exited before startup completed${signal ? ` (signal: ${signal})` : ''}`,
      });
    };

    child.once('error', onError);
    child.once('exit', onExit);

    startupTimer = setTimeout(() => {
      child.unref();
      settle({
        success: true,
        exitCode: 0,
        logFile,
        output: 'Job started in background',
      });
    }, DETACHED_STARTUP_GRACE_MS);

    startupTimer.unref?.();
  });
}
