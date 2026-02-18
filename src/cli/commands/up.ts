/**
 * `agent-oven up` — Start runtime + daemon
 */

import type { Command } from 'commander';
import { requireConfig, handleError } from '../utils/errors.js';
import { platform } from '../../core/platform.js';
import { success, info } from '../utils/output.js';

export function register(program: Command): void {
  program
    .command('up')
    .description('Start the container runtime and scheduler daemon')
    .action(async () => {
      try {
        const config = requireConfig();

        // Step 1: Runtime
        const runtime = await platform.getRuntimeStatus();
        if (runtime.running) {
          info(platform.needsVM ? 'Colima is already running' : 'Docker is already running');
        } else if (platform.needsVM) {
          info('Starting Colima...');
          await platform.startRuntime(config);
          success('Colima started');
        } else {
          // On Linux, we can't start Docker for the user
          await platform.startRuntime(config);
        }

        // Step 2: Daemon
        if (!platform.daemonConfigExists()) {
          info('Scheduler config not found — skipping daemon. Run `agent-oven init` to set up.');
          return;
        }

        const sched = await platform.getSchedulerStatus();
        if (sched.loaded) {
          info('Scheduler daemon is already loaded');
        } else {
          await platform.startDaemon();
          success('Scheduler daemon started');
        }

        success('System is up');
      } catch (err) {
        handleError(err);
      }
    });
}
