/**
 * Shared CLI error handling utilities
 */

import { loadConfig } from '../../core/config.js';
import { getJob } from '../../core/jobs.js';
import type { Config, Job } from '../../core/types.js';
import { error } from './output.js';

/**
 * Print error message and exit with code 1
 */
export function handleError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  error(msg);
  process.exit(1);
}

/**
 * Load config, exiting with a helpful message if projectDir is missing
 */
export function requireConfig(): Config {
  const config = loadConfig();
  if (!config.projectDir) {
    error('No project directory configured. Run `agent-oven init` first.');
    process.exit(1);
  }
  return config;
}

/**
 * Get a job by ID, exiting with "Job not found" if null
 */
export function requireJob(config: Config, id: string): Job {
  const job = getJob(config, id);
  if (!job) {
    error(`Job '${id}' not found`);
    process.exit(1);
  }
  return job;
}
