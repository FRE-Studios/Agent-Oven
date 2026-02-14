/**
 * `agent-oven list` — List all jobs
 */

import type { Command } from 'commander';
import { requireConfig, handleError } from '../utils/errors.js';
import { printTable } from '../utils/output.js';
import { listJobs } from '../../core/jobs.js';
import { describeSchedule, getNextRun, formatRelativeTime } from '../../core/scheduler.js';

export function register(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List all jobs')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = requireConfig();
        const jobs = listJobs(config);

        if (opts.json) {
          console.log(JSON.stringify(jobs, null, 2));
          return;
        }

        if (jobs.length === 0) {
          console.log('No jobs configured. Use `agent-oven add` to create one.');
          return;
        }

        const rows = jobs.map((job) => {
          const schedule = describeSchedule(job.schedule);
          const next = getNextRun(job.schedule);
          const nextStr = next ? formatRelativeTime(next) : '—';
          const enabled = job.enabled !== false;
          const status = enabled ? 'enabled' : 'disabled';

          return [job.id, job.type, schedule, nextStr, status];
        });

        printTable(['ID', 'TYPE', 'SCHEDULE', 'NEXT RUN', 'STATUS'], rows);
      } catch (err) {
        handleError(err);
      }
    });
}
