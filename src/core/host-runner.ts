/**
 * Host execution layer.
 *
 * Runs a job's command directly on the host machine under the scheduler's user
 * — no container, no image, no container runtime. Host jobs run arbitrary
 * commands with NO isolation; see README/CLAUDE.md for the security note.
 */

import { execa, type ExecaError } from 'execa';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, HostJob, JobRunResult } from './types.js';
import {
  prepareLogFile,
  shellEscape,
  spawnDetachedRun,
} from './run-utils.js';
import { acquirePidFile, getPidFilePath, writePidFile, removePidFile } from './host-lock.js';

/**
 * Common binary locations to ensure are on PATH. The scheduler runs under
 * launchd/systemd with a minimal environment, so a bare `node`/`python3`/`git`
 * may not resolve even though it works in an interactive shell.
 */
const COMMON_BIN_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

/**
 * Build the child environment: inherit process.env, prepend any missing common
 * binary locations to PATH, then apply job.env last (job overrides win).
 */
function buildHostEnv(jobEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env };
  const existing = base.PATH ? base.PATH.split(path.delimiter) : [];
  const missing = COMMON_BIN_PATHS.filter((p) => !existing.includes(p));
  base.PATH = [...missing, ...existing].join(path.delimiter);
  return { ...base, ...jobEnv };
}

/** Resolve a host job's working directory against config.projectDir. */
function resolveCwd(config: Config, job: HostJob): string {
  if (!job.cwd) return config.projectDir;
  return path.resolve(config.projectDir, job.cwd);
}

/**
 * Decide whether to run through a shell. A string command, or an explicit
 * `shell: true`, runs through the shell (enables pipes/globs). An array command
 * runs argv-style with no shell, avoiding quoting pitfalls.
 */
function shouldUseShell(job: HostJob): boolean {
  return job.shell === true || typeof job.command === 'string';
}

/** A human-readable rendering of the command for the log header. */
function describeCommand(command: string | string[]): string {
  return Array.isArray(command) ? command.join(' ') : command;
}

/**
 * Run a host job — a command executed directly on the host.
 */
export async function runHostJob(
  config: Config,
  job: HostJob,
  options: { detach?: boolean } = {}
): Promise<JobRunResult> {
  const logFile = prepareLogFile(config, job.id);
  const cwd = resolveCwd(config, job);
  const env = buildHostEnv(job.env);
  const useShell = shouldUseShell(job);

  // Resolve timeout: prefer resources.timeout, then legacy timeout (Docker parity).
  const timeoutSeconds = job.resources?.timeout ?? job.timeout;

  const logHeader = [
    `=== Job: ${job.id} ===`,
    `=== Type: host ===`,
    `=== Started: ${new Date().toISOString()} ===`,
    `=== Command: ${describeCommand(job.command)} ===`,
    `=== Cwd: ${cwd} ===`,
    '',
  ].join('\n');
  fs.writeFileSync(logFile, logHeader);

  if (!acquirePidFile(config, job.id)) {
    const message = `Host job ${job.id} is already running, or its lockfile could not be acquired`;
    fs.appendFileSync(logFile, [
      `=== Skipped: ${new Date().toISOString()} ===`,
      `=== Exit Code: 1 ===`,
      `=== Error: ${message} ===`,
    ].join('\n'));
    return {
      success: false,
      exitCode: 1,
      logFile,
      output: message,
    };
  }

  if (options.detach) {
    // Build a shell-ready command line. Array commands are shell-escaped
    // argv-by-argv; string/shell commands are passed through verbatim.
    const commandLine = useShell
      ? describeCommand(job.command)
      : (job.command as string[]).map(shellEscape).join(' ');
    const pidFile = getPidFilePath(config, job.id);

    const result = await spawnDetachedRun(commandLine, logFile, {
      cwd,
      env,
      onSpawn: (pid) => writePidFile(config, job.id, pid),
      // The parent exits immediately, so the detached process must clear its
      // own lockfile when it finishes.
      cleanupCommand: `rm -f ${shellEscape(pidFile)}`,
    });
    if (!result.success) {
      removePidFile(config, job.id);
    }
    return result;
  }

  // Foreground run with timeout.
  const subprocess = useShell
    ? execa(describeCommand(job.command), {
        shell: true,
        cwd,
        env,
        timeout: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
        reject: false,
      })
    : execa((job.command as string[])[0], (job.command as string[]).slice(1), {
        cwd,
        env,
        timeout: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
        reject: false,
      });

  writePidFile(config, job.id, subprocess.pid);

  try {
    const result = await subprocess;

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const failed = result.failed === true || result.exitCode !== 0;
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 1;
    const message = 'message' in result && result.failed === true ? result.message : '';
    const logContent = [
      stdout,
      stderr,
      '',
      `=== Finished: ${new Date().toISOString()} ===`,
      `=== Exit Code: ${exitCode} ===`,
      ...(message ? [`=== Error: ${message} ===`] : []),
    ].filter(Boolean).join('\n');
    fs.appendFileSync(logFile, logContent);

    return {
      success: !failed,
      exitCode,
      logFile,
      output: stdout || (failed ? stderr || message : stdout),
    };
  } catch (err) {
    const error = err as ExecaError;
    const errStdout = typeof error.stdout === 'string' ? error.stdout : '';
    const errStderr = typeof error.stderr === 'string' ? error.stderr : '';
    const logContent = [
      errStdout,
      errStderr,
      '',
      `=== Finished: ${new Date().toISOString()} ===`,
      `=== Exit Code: ${error.exitCode ?? 1} ===`,
      `=== Error: ${error.message} ===`,
    ].filter(Boolean).join('\n');
    fs.appendFileSync(logFile, logContent);

    return {
      success: false,
      exitCode: error.exitCode ?? 1,
      logFile,
      output: errStderr || error.message,
    };
  } finally {
    removePidFile(config, job.id);
  }
}
