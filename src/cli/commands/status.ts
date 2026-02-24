/**
 * `agent-oven status` — System status overview
 */

import type { Command } from 'commander';
import { requireConfig, handleError } from '../utils/errors.js';
import { statusIcon } from '../utils/output.js';
import { platform } from '../../core/platform.js';

export function register(program: Command): void {
  program
    .command('status')
    .description('Show system status overview')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = requireConfig();
        const { getSystemStatus } = await import('../../core/docker.js');
        const status = await getSystemStatus(config);

        if (opts.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        const runtimeLabel = platform.needsVM ? 'Colima' : 'Docker';

        console.log('\nAgent Oven Status');

        // Runtime
        const runtime = status.runtime;
        if (runtime.running) {
          const specs = [
            runtime.cpu ? `${runtime.cpu} CPU` : null,
            runtime.memory ? `${runtime.memory}GB RAM` : null,
            runtime.disk ? `${runtime.disk}GB disk` : null,
          ].filter(Boolean).join(', ');
          console.log(`  ${runtimeLabel.padEnd(12)} ${statusIcon(true)} Running${specs ? ` (${specs})` : ''}`);
        } else {
          console.log(`  ${runtimeLabel.padEnd(12)} ${statusIcon(false)} Stopped`);
        }

        // Scheduler
        const sched = status.scheduler;
        if (sched.loaded) {
          const exit = sched.lastExitStatus !== undefined ? ` (last exit: ${sched.lastExitStatus})` : '';
          console.log(`  Scheduler:    ${statusIcon(true)} Loaded${exit}`);
        } else {
          console.log(`  Scheduler:    ${statusIcon(false)} Not loaded`);
        }

        // Jobs
        const j = status.jobs;
        console.log(`  Jobs:         ${j.total} total, ${j.enabled} enabled, ${j.cron} cron, ${j.randomWindow} random-window, ${j.oncePending} pending`);

        // Running containers
        if (status.runningContainers.length > 0) {
          console.log(`  Running:      ${status.runningContainers.length} container${status.runningContainers.length > 1 ? 's' : ''}`);
          for (const c of status.runningContainers) {
            console.log(`    ${c.name} (${c.image})`);
          }
        } else {
          console.log('  Running:      0 containers');
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}
