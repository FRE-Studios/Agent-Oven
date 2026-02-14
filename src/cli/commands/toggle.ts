/**
 * `agent-oven toggle <id>` — Enable/disable a job
 */

import type { Command } from 'commander';
import { requireConfig, requireJob, handleError } from '../utils/errors.js';
import { toggleJob } from '../../core/jobs.js';
import { success } from '../utils/output.js';

export function register(program: Command): void {
  program
    .command('toggle <id>')
    .description('Toggle a job enabled/disabled')
    .action(async (id: string) => {
      try {
        const config = requireConfig();
        requireJob(config, id); // ensure it exists
        const updated = toggleJob(config, id);
        const state = updated.enabled !== false ? 'enabled' : 'disabled';
        success(`Job '${id}' ${state}`);
      } catch (err) {
        handleError(err);
      }
    });
}
