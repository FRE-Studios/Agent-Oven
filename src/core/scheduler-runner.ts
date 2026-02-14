/**
 * Scheduler tick runner — executes one scheduler cycle.
 * Called by `agent-oven scheduler-tick` (via launchd every 60s).
 *
 * Reuses existing modules: jobs.ts, docker.ts, scheduler.ts, config.ts.
 * Only housekeeping helpers (log rotation, pruning) and the orchestration
 * loop are new here.
 */

import { execa } from 'execa';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './types.js';
import { listJobs, updateLastRun, removeJob } from './jobs.js';
import { getColimaStatus, startColima, runJob } from './docker.js';
import { shouldRunNow } from './scheduler.js';
import { getLogsDir, getSchedulerLogPath } from './config.js';

/**
 * Timestamped log to stdout.
 * launchd redirects stdout/stderr to scheduler.log via the plist.
 */
function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

/**
 * Rotate scheduler.log: trim to 5K lines when it exceeds 10K.
 */
function rotateSchedulerLog(config: Config): void {
  const logPath = getSchedulerLogPath(config);
  if (!fs.existsSync(logPath)) return;

  let content: string;
  try {
    content = fs.readFileSync(logPath, 'utf-8');
  } catch {
    return;
  }

  const lines = content.split('\n');
  if (lines.length > 10_000) {
    const trimmed = lines.slice(-5_000).join('\n');
    try {
      fs.writeFileSync(logPath, trimmed);
      log(`Rotated scheduler log (was ${lines.length} lines)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`WARN: Failed to rotate scheduler log: ${msg}`);
    }
  }
}

/**
 * Delete *.log files in logs/jobs/ older than 90 days.
 */
function pruneOldJobLogs(config: Config): void {
  const jobsLogsDir = path.join(getLogsDir(config), 'jobs');
  if (!fs.existsSync(jobsLogsDir)) return;

  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ninetyDaysMs;
  let pruned = 0;

  try {
    for (const jobId of fs.readdirSync(jobsLogsDir)) {
      const jobDir = path.join(jobsLogsDir, jobId);
      if (!fs.statSync(jobDir).isDirectory()) continue;

      for (const file of fs.readdirSync(jobDir)) {
        if (!file.endsWith('.log')) continue;
        const filePath = path.join(jobDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            pruned++;
          }
        } catch {
          // skip files we can't stat/delete
        }
      }
    }
  } catch {
    // skip if directory listing fails
  }

  if (pruned > 0) {
    log(`Pruned ${pruned} job log(s) older than 90 days`);
  }
}

/**
 * Weekly `docker system prune -f --volumes` tracked via marker file.
 */
async function pruneDockerResources(config: Config): Promise<void> {
  const logsDir = getLogsDir(config);
  const marker = path.join(logsDir, '.last_docker_prune');
  const now = Math.floor(Date.now() / 1000);
  const oneWeek = 604_800; // 7 days in seconds

  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`WARN: Failed to prepare logs directory for prune marker: ${msg}`);
    return;
  }

  if (fs.existsSync(marker)) {
    try {
      const lastPrune = parseInt(fs.readFileSync(marker, 'utf-8').trim(), 10);
      if (Number.isFinite(lastPrune) && now - lastPrune < oneWeek) return;
    } catch {
      // if marker is unreadable, proceed with prune
    }
  }

  log('Running weekly Docker system prune');
  try {
    await execa('docker', ['system', 'prune', '-f', '--volumes']);
  } catch {
    // prune failure is non-fatal
  }
  try {
    fs.writeFileSync(marker, String(now));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`WARN: Failed to write docker prune marker: ${msg}`);
  }
}

/**
 * Check if a job's container is already running.
 */
async function isJobRunning(jobId: string): Promise<boolean> {
  try {
    const { stdout } = await execa(
      'docker',
      ['inspect', '--format', '{{.State.Running}}', `oven-${jobId}`],
      { reject: false },
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Start Colima if not running.
 */
async function ensureColima(config: Config): Promise<void> {
  const status = await getColimaStatus();
  if (status.running) return;

  log(
    `Colima not running, starting with cpu=${config.colima.cpu} memory=${config.colima.memory} disk=${config.colima.disk}...`,
  );
  await startColima(config);
}

/**
 * Run one complete scheduler tick.
 * Returns a process exit code (0 = success, 1 = error).
 */
export async function runSchedulerTick(config: Config): Promise<number> {
  log('Scheduler run started');

  // --- Housekeeping ---
  try {
    rotateSchedulerLog(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`WARN: Scheduler log rotation failed: ${msg}`);
  }
  try {
    pruneOldJobLogs(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`WARN: Job log pruning failed: ${msg}`);
  }
  try {
    await pruneDockerResources(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`WARN: Docker prune failed: ${msg}`);
  }

  // --- Load jobs ---
  const jobs = listJobs(config);
  if (jobs.length === 0) {
    log('No jobs configured');
    log('Scheduler run completed');
    return 0;
  }

  // --- Ensure Colima ---
  try {
    await ensureColima(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR: Failed to start Colima: ${msg}`);
    return 1;
  }

  // --- Process each job ---
  for (const job of jobs) {
    // Skip disabled jobs
    if (job.enabled === false) continue;

    // Check schedule
    if (!shouldRunNow(job.schedule, job.last_run)) continue;

    // Skip if container is already running
    if (await isJobRunning(job.id)) {
      log(`Skipping job ${job.id}: container oven-${job.id} is still running`);
      continue;
    }

    // Execute
    log(`Running job: ${job.id}`);
    const result = await runJob(config, job);

    if (result.success) {
      log(`Job ${job.id} completed successfully`);
    } else {
      log(`Job ${job.id} failed with exit code ${result.exitCode}`);
    }

    // Update last_run
    updateLastRun(config, job.id);

    // Remove one-time jobs after execution
    if (job.schedule.type === 'once') {
      removeJob(config, job.id);
      log(`Removed completed one-time job: ${job.id}`);
    }
  }

  log('Scheduler run completed');
  return 0;
}
