/**
 * `agent-oven down` — Stop daemon + runtime
 */

import type { Command } from 'commander';
import { handleError } from '../utils/errors.js';
import { platform } from '../../core/platform.js';
import { getRunningContainers } from '../../core/docker.js';
import { success, warn, info } from '../utils/output.js';
import { confirm } from '../utils/prompts.js';

export function register(program: Command): void {
  program
    .command('down')
    .description('Stop the scheduler daemon and container runtime')
    .option('--force', 'Skip warning about running containers')
    .action(async (opts: { force?: boolean }) => {
      try {
        // Check for running containers
        if (!opts.force) {
          const containers = await getRunningContainers();
          if (containers.length > 0) {
            warn(`${containers.length} container(s) still running:`);
            for (const c of containers) {
              console.log(`  ${c.name} (${c.image})`);
            }
            const ok = await confirm('Stop everything anyway?');
            if (!ok) {
              info('Cancelled');
              return;
            }
          }
        }

        // Step 1: Unload daemon
        const sched = await platform.getSchedulerStatus();
        if (sched.loaded) {
          await platform.stopDaemon();
          success('Scheduler daemon stopped');
        } else {
          info('Scheduler daemon was not loaded');
        }

        // Step 2: Stop runtime (only meaningful on macOS with Colima)
        if (platform.needsVM) {
          info('Stopping Colima...');
          await platform.stopRuntime();
          success('Colima stopped');
        }

        success('System is down');
      } catch (err) {
        handleError(err);
      }
    });
}
