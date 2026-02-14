/**
 * `agent-oven show <id>` — Show single job details
 */

import type { Command } from 'commander';
import { requireConfig, requireJob, handleError } from '../utils/errors.js';
import { describeSchedule, getNextRun, formatRelativeTime } from '../../core/scheduler.js';
import { getRecentExecutions } from '../../core/docker.js';
import { isDockerJob, isPipelineJob } from '../../core/types.js';

export function register(program: Command): void {
  program
    .command('show <id>')
    .description('Show job details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const config = requireConfig();
        const job = requireJob(config, id);

        if (opts.json) {
          console.log(JSON.stringify(job, null, 2));
          return;
        }

        console.log(`\nJob: ${job.id}`);
        console.log(`  Name:       ${job.name}`);
        console.log(`  Type:       ${job.type}`);
        console.log(`  Status:     ${job.enabled !== false ? 'enabled' : 'disabled'}`);

        if (isDockerJob(job)) {
          console.log(`  Image:      ${job.image}`);
          const cmd = Array.isArray(job.command) ? job.command.join(' ') : job.command;
          console.log(`  Command:    ${cmd}`);
          if (job.volumes && job.volumes.length > 0) {
            console.log(`  Volumes:    ${job.volumes.join(', ')}`);
          }
        }

        if (isPipelineJob(job)) {
          console.log(`  Repo:       ${job.source.repo}`);
          console.log(`  Branch:     ${job.source.branch ?? 'main'}`);
          console.log(`  Pipeline:   ${job.pipeline}`);
          if (job.auth) {
            console.log(`  Auth:       ${job.auth}`);
          }
        }

        console.log(`  Schedule:   ${describeSchedule(job.schedule)}`);
        const next = getNextRun(job.schedule);
        if (next) {
          console.log(`  Next run:   ${formatRelativeTime(next)}`);
        }

        if (job.resources) {
          const parts: string[] = [];
          if (job.resources.timeout) parts.push(`timeout=${job.resources.timeout}s`);
          if (job.resources.cpus) parts.push(`cpus=${job.resources.cpus}`);
          if (job.resources.memory) parts.push(`memory=${job.resources.memory}`);
          if (parts.length > 0) {
            console.log(`  Resources:  ${parts.join(', ')}`);
          }
        }

        if (job.env && Object.keys(job.env).length > 0) {
          console.log(`  Env keys:   ${Object.keys(job.env).join(', ')}`);
        }

        if (job.last_run) {
          console.log(`  Last run:   ${job.last_run}`);
        }

        // Recent executions
        const recent = getRecentExecutions(config, 5)
          .filter((e) => e.jobId === job.id);
        if (recent.length > 0) {
          console.log('\n  Recent runs:');
          for (const entry of recent) {
            const code = entry.exitCode === 'running' ? 'running' : `exit ${entry.exitCode}`;
            console.log(`    ${entry.timestamp}  ${code}`);
          }
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}
