/**
 * `agent-oven run <id>` — Run a job immediately
 */

import type { Command } from 'commander';
import { requireConfig, requireJob, handleError } from '../utils/errors.js';
import { runJob } from '../../core/docker.js';
import { success, error, info } from '../utils/output.js';

export function register(program: Command): void {
  program
    .command('run <id>')
    .description('Run a job immediately')
    .option('--wait', 'Run in foreground and stream output')
    .option('--detach', 'Run in background (default)')
    .action(async (id: string, opts: { wait?: boolean; detach?: boolean }) => {
      try {
        const config = requireConfig();
        const job = requireJob(config, id);

        const detach = !opts.wait;

        if (detach) {
          info(`Starting job '${id}' in background...`);
        } else {
          info(`Running job '${id}'...`);
        }

        const result = await runJob(config, job, { detach });

        if (result.success) {
          success(`Job '${id}' completed (exit code: ${result.exitCode})`);
          if (opts.wait && result.output) {
            console.log(result.output);
          }
        } else {
          error(`Job '${id}' failed (exit code: ${result.exitCode})`);
          if (result.output) {
            console.error(result.output);
          }
          process.exit(result.exitCode || 1);
        }

        info(`Log: ${result.logFile}`);
      } catch (err) {
        handleError(err);
      }
    });
}
