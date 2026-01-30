/**
 * Job management - CRUD operations for jobs.json
 */

import * as fs from 'node:fs';
import type {
  Config,
  Job,
  DockerJob,
  PipelineJob,
  JobsFile,
  AddJobOptions,
  UpdateJobOptions,
} from './types.js';
import { isDockerJob, isPipelineJob } from './types.js';
import { getJobsFilePath } from './config.js';

/**
 * Normalize a legacy job (no `type` field) to a DockerJob.
 * Jobs with `image` and `command` but no `type` are treated as Docker jobs.
 */
function normalizeJob(raw: Record<string, unknown>): Job {
  if (raw.type === 'docker' || raw.type === 'agent-pipeline') {
    return raw as unknown as Job;
  }

  // Legacy job: has image+command but no type field
  if ('image' in raw && 'command' in raw) {
    return { ...raw, type: 'docker' } as unknown as DockerJob;
  }

  // Unknown format - default to docker type to avoid breaking
  return { ...raw, type: 'docker' } as unknown as DockerJob;
}

/**
 * Read the jobs file
 */
function readJobsFile(config: Config): JobsFile {
  const jobsPath = getJobsFilePath(config);

  if (!fs.existsSync(jobsPath)) {
    return { jobs: [] };
  }

  const content = fs.readFileSync(jobsPath, 'utf-8');
  const data = JSON.parse(content) as { jobs: Record<string, unknown>[] };

  // Normalize all jobs on read
  return {
    jobs: data.jobs.map(normalizeJob),
  };
}

/**
 * Write the jobs file
 */
function writeJobsFile(config: Config, data: JobsFile): void {
  const jobsPath = getJobsFilePath(config);
  fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * List all jobs
 */
export function listJobs(config: Config): Job[] {
  return readJobsFile(config).jobs;
}

/**
 * Get a single job by ID
 */
export function getJob(config: Config, jobId: string): Job | null {
  const jobs = listJobs(config);
  return jobs.find((job) => job.id === jobId) ?? null;
}

/**
 * Add a new job
 * @throws Error if job with same ID already exists
 */
export function addJob(config: Config, options: AddJobOptions): Job {
  const data = readJobsFile(config);

  // Check for duplicate ID
  if (data.jobs.some((job) => job.id === options.id)) {
    throw new Error(`Job with ID "${options.id}" already exists`);
  }

  // Validate required fields based on type
  if (!options.id || !options.name || !options.schedule) {
    throw new Error('Missing required fields: id, name, schedule');
  }

  if (options.type === 'docker') {
    if (!options.image || !options.command) {
      throw new Error('Docker jobs require: image, command');
    }
  } else if (options.type === 'agent-pipeline') {
    if (!options.source || !options.pipeline) {
      throw new Error('Pipeline jobs require: source, pipeline');
    }
  }

  // Validate ID format (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(options.id)) {
    throw new Error('Job ID must contain only letters, numbers, hyphens, and underscores');
  }

  const job: Job = {
    ...options,
    last_run: null,
  } as Job;

  data.jobs.push(job);
  writeJobsFile(config, data);

  return job;
}

/**
 * Update an existing job
 * @throws Error if job does not exist
 */
export function updateJob(config: Config, jobId: string, updates: UpdateJobOptions): Job {
  const data = readJobsFile(config);
  const index = data.jobs.findIndex((job) => job.id === jobId);

  if (index === -1) {
    throw new Error(`Job with ID "${jobId}" not found`);
  }

  const updatedJob: Job = {
    ...data.jobs[index],
    ...updates,
  } as Job;

  data.jobs[index] = updatedJob;
  writeJobsFile(config, data);

  return updatedJob;
}

/**
 * Remove a job
 * @throws Error if job does not exist
 */
export function removeJob(config: Config, jobId: string): void {
  const data = readJobsFile(config);
  const index = data.jobs.findIndex((job) => job.id === jobId);

  if (index === -1) {
    throw new Error(`Job with ID "${jobId}" not found`);
  }

  data.jobs.splice(index, 1);
  writeJobsFile(config, data);
}

/**
 * Toggle a job's enabled status
 */
export function toggleJob(config: Config, jobId: string): Job {
  const job = getJob(config, jobId);
  if (!job) {
    throw new Error(`Job with ID "${jobId}" not found`);
  }

  const newEnabled = !(job.enabled ?? true);
  return updateJob(config, jobId, { enabled: newEnabled });
}

/**
 * Update a job's last_run timestamp
 */
export function updateLastRun(config: Config, jobId: string, timestamp?: string): Job {
  const ts = timestamp ?? new Date().toISOString().split('.')[0];
  return updateJob(config, jobId, { last_run: ts });
}

/**
 * Get job statistics
 */
export function getJobStats(config: Config): {
  total: number;
  enabled: number;
  cron: number;
  oncePending: number;
} {
  const jobs = listJobs(config);

  return {
    total: jobs.length,
    enabled: jobs.filter((j) => j.enabled !== false).length,
    cron: jobs.filter((j) => j.schedule.type === 'cron').length,
    oncePending: jobs.filter(
      (j) => j.schedule.type === 'once' && !j.last_run
    ).length,
  };
}

/**
 * Get available Docker images (the built-in ones)
 */
export function getBuiltInImages(): string[] {
  return [
    'agent-oven/base-tasks',
    'agent-oven/python-tasks',
    'agent-oven/node-tasks',
    'agent-oven/pipeline-runner',
  ];
}

/**
 * Validate a job configuration
 */
export function validateJob(job: Partial<Job>): string[] {
  const errors: string[] = [];

  if (!job.id) {
    errors.push('Job ID is required');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(job.id)) {
    errors.push('Job ID must contain only letters, numbers, hyphens, and underscores');
  }

  if (!job.name) {
    errors.push('Job name is required');
  }

  // Type-specific validation
  const jobType = (job as Record<string, unknown>).type;

  if (jobType === 'agent-pipeline') {
    const pj = job as Partial<PipelineJob>;
    if (!pj.source) {
      errors.push('Source configuration is required for pipeline jobs');
    } else if (!pj.source.repo) {
      errors.push('Source repo URL is required');
    }
    if (!pj.pipeline) {
      errors.push('Pipeline name is required');
    }
  } else {
    // Docker job (default)
    const dj = job as Partial<DockerJob>;
    if (!dj.image) {
      errors.push('Docker image is required');
    }
    if (!dj.command) {
      errors.push('Command is required');
    }
  }

  if (!job.schedule) {
    errors.push('Schedule is required');
  } else {
    if (job.schedule.type === 'cron') {
      if (!job.schedule.cron) {
        errors.push('Cron expression is required for cron schedule');
      } else {
        // Basic cron validation (5 fields)
        const parts = job.schedule.cron.trim().split(/\s+/);
        if (parts.length !== 5) {
          errors.push('Cron expression must have 5 fields (minute hour day month weekday)');
        }
      }
    } else if (job.schedule.type === 'once') {
      if (!job.schedule.datetime) {
        errors.push('Datetime is required for one-time schedule');
      } else {
        // Basic datetime validation
        const date = new Date(job.schedule.datetime);
        if (isNaN(date.getTime())) {
          errors.push('Invalid datetime format');
        }
      }
    }
  }

  // Validate resources if present
  if (job.resources) {
    if (job.resources.timeout !== undefined && job.resources.timeout < 0) {
      errors.push('Resources timeout must be a positive number');
    }
    if (job.resources.cpus !== undefined && job.resources.cpus <= 0) {
      errors.push('Resources CPUs must be a positive number');
    }
  }

  // Legacy timeout validation (DockerJob)
  if ('timeout' in job && (job as DockerJob).timeout !== undefined && (job as DockerJob).timeout! < 0) {
    errors.push('Timeout must be a positive number');
  }

  return errors;
}
