/**
 * `agent-oven delete <id>` — Delete a job
 */

import type { Command } from 'commander';
import { requireConfig, requireJob, handleError } from '../utils/errors.js';
import { removeJob } from '../../core/jobs.js';
import { success, info } from '../utils/output.js';
import { confirm } from '../utils/prompts.js';

export function register(program: Command): void {
  program
    .command('delete <id>')
    .alias('rm')
    .description('Delete a job')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, opts: { yes?: boolean }) => {
      try {
        const config = requireConfig();
        const job = requireJob(config, id);

        info(`Job '${id}' (${job.name}) — type: ${job.type}`);

        if (!opts.yes) {
          const ok = await confirm(`Delete job '${id}'?`);
          if (!ok) {
            info('Cancelled');
            return;
          }
        }

        removeJob(config, id);
        success(`Job '${id}' deleted`);
      } catch (err) {
        handleError(err);
      }
    });
}
