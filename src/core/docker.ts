/**
 * Docker execution layer
 * Handles container operations via Colima
 */

import { execa, type ExecaError } from 'execa';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Config,
  Job,
  DockerJob,
  PipelineJob,
  RunningContainer,
  JobLogEntry,
  JobRunResult,
  SystemStatus,
} from './types.js';
import { isPipelineJob } from './types.js';
import {
  getLogsDir,
  getJobLogsDir,
  getSchedulerLogPath,
} from './config.js';
import { getJobStats } from './jobs.js';
import {
  resolveAuthMode,
  generateAuthArgs,
  validateAuthForJob,
  DEFAULT_AUTH_CONFIG,
} from './auth.js';
import { platform } from './platform.js';

/**
 * Get list of running job containers
 */
export async function getRunningContainers(): Promise<RunningContainer[]> {
  try {
    const { stdout } = await execa('docker', [
      'ps',
      '--filter', 'name=oven-',
      '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}',
    ], { reject: false });

    if (!stdout.trim()) {
      return [];
    }

    return stdout.trim().split('\n').map((line) => {
      const [name, status, image] = line.split('\t');
      return {
        name,
        status,
        image,
        jobId: name.startsWith('oven-') ? name.slice(5) : undefined,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get recent job executions from log files
 */
export function getRecentExecutions(config: Config, limit = 5): JobLogEntry[] {
  const jobsLogsDir = path.join(getLogsDir(config), 'jobs');

  if (!fs.existsSync(jobsLogsDir)) {
    return [];
  }

  const entries: JobLogEntry[] = [];

  try {
    const jobDirs = fs.readdirSync(jobsLogsDir);

    for (const jobId of jobDirs) {
      const jobDir = path.join(jobsLogsDir, jobId);
      const stat = fs.statSync(jobDir);

      if (!stat.isDirectory()) continue;

      const logFiles = fs.readdirSync(jobDir)
        .filter((f) => f.endsWith('.log'))
        .sort()
        .reverse();

      for (const logFile of logFiles) {
        const logPath = path.join(jobDir, logFile);
        const timestamp = logFile.replace('.log', '');

        // Try to read exit code from log
        let exitCode: number | 'running' = 'running';
        try {
          const content = fs.readFileSync(logPath, 'utf-8');
          const exitMatch = content.match(/Exit Code:\s*(\d+)/);
          if (exitMatch) {
            exitCode = parseInt(exitMatch[1], 10);
          }
        } catch {
          // Ignore read errors
        }

        entries.push({
          jobId,
          timestamp,
          logFile: logPath,
          exitCode,
        });
      }
    }
  } catch {
    // Ignore errors reading log directory
  }

  // Sort by timestamp descending and limit
  return entries
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/**
 * Get complete system status
 */
export async function getSystemStatus(config: Config): Promise<SystemStatus> {
  const [runtime, scheduler, runningContainers] = await Promise.all([
    platform.getRuntimeStatus(),
    platform.getSchedulerStatus(),
    getRunningContainers(),
  ]);

  const jobs = getJobStats(config);
  const recentExecutions = getRecentExecutions(config);

  return {
    runtime,
    scheduler,
    jobs,
    runningContainers,
    recentExecutions,
  };
}

/**
 * Prepare log file and directory for a job run.
 */
function prepareLogFile(config: Config, jobId: string): string {
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
 * Run a job immediately - routes to the appropriate handler based on job type.
 */
export async function runJob(
  config: Config,
  job: Job,
  options: { detach?: boolean } = {}
): Promise<JobRunResult> {
  if (isPipelineJob(job)) {
    return runPipelineJob(config, job, options);
  }
  // Default: Docker job (also handles any legacy jobs)
  return runDockerJob(config, job as DockerJob, options);
}

/**
 * Escape a string for safe use as a POSIX shell argument.
 */
function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Give detached jobs a brief grace period to surface immediate startup failures. */
const DETACHED_STARTUP_GRACE_MS = 750;

function closeLogFd(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Ignore close errors
  }
}

function readLogTail(logFile: string, maxChars = 4096): string {
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

/**
 * Spawn a detached Docker process that streams output to a log file.
 * The parent process can exit immediately; the Docker container
 * continues running with stdout/stderr flowing to the log.
 * When the container exits, finish markers and exit code are appended.
 */
async function spawnDetachedDockerRun(
  args: string[],
  logFile: string,
): Promise<JobRunResult> {
  const logFd = fs.openSync(logFile, 'a');

  const dockerCmd = ['docker', ...args].map(shellEscape).join(' ');

  // Run docker in foreground inside a detached shell.
  // After docker exits, append finish markers with the exit code.
  const script = [
    dockerCmd,
    'EC=$?',
    `printf '\\n=== Finished: %s ===\\n=== Exit Code: %d ===\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EC"`,
  ].join('\n');

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn('sh', ['-c', script], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
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

/**
 * Run a Docker container job.
 */
async function runDockerJob(
  config: Config,
  job: DockerJob,
  options: { detach?: boolean } = {}
): Promise<JobRunResult> {
  const logFile = prepareLogFile(config, job.id);

  // Build docker command arguments
  const args: string[] = ['run', '--rm', `--name=oven-${job.id}`];

  // Resource limits: prefer job.resources, then legacy fields, then config defaults
  const cpus = job.resources?.cpus ?? config.docker.defaultCpus;
  const memory = job.resources?.memory ?? config.docker.defaultMemory;
  args.push(`--cpus=${cpus}`);
  args.push(`--memory=${memory}`);

  // Add volumes
  if (job.volumes) {
    for (const vol of job.volumes) {
      args.push('-v', vol);
    }
  }

  // Add environment variables
  if (job.env) {
    for (const [key, value] of Object.entries(job.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  // Add image
  args.push(job.image);

  // Add command
  if (Array.isArray(job.command)) {
    args.push(...job.command);
  } else {
    args.push(job.command);
  }

  // Resolve timeout: prefer resources.timeout, then legacy timeout
  const timeoutSeconds = job.resources?.timeout ?? job.timeout;

  // Write log header
  const logHeader = [
    `=== Job: ${job.id} ===`,
    `=== Type: docker ===`,
    `=== Started: ${new Date().toISOString()} ===`,
    `=== Command: docker ${args.join(' ')} ===`,
    '',
  ].join('\n');
  fs.writeFileSync(logFile, logHeader);

  if (options.detach) {
    return spawnDetachedDockerRun(args, logFile);
  }

  // Run in foreground with timeout
  try {
    const result = await execa('docker', args, {
      timeout: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
      reject: false,
    });

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const logContent = [
      stdout,
      stderr,
      '',
      `=== Finished: ${new Date().toISOString()} ===`,
      `=== Exit Code: ${result.exitCode} ===`,
    ].filter(Boolean).join('\n');
    fs.appendFileSync(logFile, logContent);

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode ?? 0,
      logFile,
      output: stdout,
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
  }
}

/**
 * Run an agent pipeline job.
 */
async function runPipelineJob(
  config: Config,
  job: PipelineJob,
  options: { detach?: boolean } = {}
): Promise<JobRunResult> {
  const logFile = prepareLogFile(config, job.id);
  const authConfig = config.auth ?? DEFAULT_AUTH_CONFIG;

  // Validate auth requirements
  let authWarnings: string[] = [];
  try {
    authWarnings = validateAuthForJob(job, authConfig);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    fs.writeFileSync(logFile, [
      `=== Job: ${job.id} ===`,
      `=== Type: agent-pipeline ===`,
      `=== Started: ${new Date().toISOString()} ===`,
      `=== Error: Auth validation failed ===`,
      errMsg,
      '',
      `=== Exit Code: 1 ===`,
    ].join('\n'));

    return {
      success: false,
      exitCode: 1,
      logFile,
      output: errMsg,
    };
  }

  // Generate auth args
  const authMode = resolveAuthMode(job, authConfig);
  const authArgs = generateAuthArgs(authMode, authConfig, job.env);

  // Build docker command arguments
  const args: string[] = ['run', '--rm', `--name=oven-${job.id}`];

  // Resource limits: default 2 CPU / 2g for pipeline jobs
  const cpus = job.resources?.cpus ?? 2;
  const memory = job.resources?.memory ?? '2g';
  args.push(`--cpus=${cpus}`);
  args.push(`--memory=${memory}`);

  // Add auth volumes
  for (const vol of authArgs.volumes) {
    args.push('-v', vol);
  }

  // Add auth env vars
  for (const [key, value] of Object.entries(authArgs.envVars)) {
    args.push('-e', `${key}=${value}`);
  }

  // Add job env vars
  if (job.env) {
    for (const [key, value] of Object.entries(job.env)) {
      // Skip auth env vars already added
      if (key in authArgs.envVars) continue;
      args.push('-e', `${key}=${value}`);
    }
  }

  // Handle local repo paths: mount the host repo into the container                                    
  // so the entrypoint can `git clone` from it inside the container.                                    
  let repoArg = job.source.repo;                                                                        
  if (repoArg === '.' || repoArg.startsWith('./') || repoArg.startsWith('/')) {                         
    const absRepo = path.resolve(config.projectDir, repoArg);                                           
    args.push('-v', `${absRepo}:/workspace/source:ro`);                                                 
    repoArg = '/workspace/source';                                                                      
  }                                                                                                     

  // Add image
  args.push('agent-oven/pipeline-runner');

  // Add entrypoint args: repo, branch, pipeline
  args.push(repoArg);
  args.push(job.source.branch ?? 'main');
  args.push(job.pipeline);

  // Timeout: default 30 minutes for pipeline jobs
  const timeoutSeconds = job.resources?.timeout ?? 1800;

  // Write log header
  const logHeader = [
    `=== Job: ${job.id} ===`,
    `=== Type: agent-pipeline ===`,
    `=== Pipeline: ${job.pipeline} ===`,
    `=== Repo: ${job.source.repo} (${job.source.branch ?? 'main'}) ===`,
    `=== Auth: ${authMode} ===`,
    ...authWarnings.map((w) => `=== WARNING: ${w} ===`),
    `=== Started: ${new Date().toISOString()} ===`,
    `=== Command: docker ${args.join(' ')} ===`,
    '',
  ].join('\n');
  fs.writeFileSync(logFile, logHeader);

  if (options.detach) {
    return spawnDetachedDockerRun(args, logFile);
  }

  // Run in foreground with timeout
  try {
    const result = await execa('docker', args, {
      timeout: timeoutSeconds * 1000,
      reject: false,
    });

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const logContent = [
      stdout,
      stderr,
      '',
      `=== Finished: ${new Date().toISOString()} ===`,
      `=== Exit Code: ${result.exitCode} ===`,
    ].filter(Boolean).join('\n');
    fs.appendFileSync(logFile, logContent);

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode ?? 0,
      logFile,
      output: stdout,
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
  }
}

/**
 * Stop a running job
 */
export async function stopJob(jobId: string): Promise<void> {
  await execa('docker', ['stop', `oven-${jobId}`], { reject: false });
}

/**
 * Read a job's log file
 */
export function readJobLog(logFile: string): string {
  if (!fs.existsSync(logFile)) {
    return '';
  }
  return fs.readFileSync(logFile, 'utf-8');
}

/**
 * Get list of log files for a job
 */
export function getJobLogFiles(config: Config, jobId: string): string[] {
  const jobLogDir = getJobLogsDir(config, jobId);

  if (!fs.existsSync(jobLogDir)) {
    return [];
  }

  return fs.readdirSync(jobLogDir)
    .filter((f) => f.endsWith('.log'))
    .sort()
    .reverse()
    .map((f) => path.join(jobLogDir, f));
}

/**
 * Read scheduler log
 */
export function readSchedulerLog(config: Config, lines = 50): string {
  const logPath = getSchedulerLogPath(config);

  if (!fs.existsSync(logPath)) {
    return '';
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['info'], { reject: false });
    return true;
  } catch {
    return false;
  }
}
