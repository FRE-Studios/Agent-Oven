/**
 * `agent-oven down` — Stop daemon + Colima
 */

import { execa } from 'execa';
import type { Command } from 'commander';
import { handleError } from '../utils/errors.js';
import { getLaunchdPlistPath } from '../../core/config.js';
import { getRunningContainers, stopColima, getSchedulerStatus } from '../../core/docker.js';
import { success, warn, info } from '../utils/output.js';
import { confirm } from '../utils/prompts.js';

export function register(program: Command): void {
  program
    .command('down')
    .description('Stop the scheduler daemon and Colima')
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
        const plistPath = getLaunchdPlistPath();
        const sched = await getSchedulerStatus();
        if (sched.loaded) {
          await execa('launchctl', ['unload', plistPath]);
          success('Scheduler daemon stopped');
        } else {
          info('Scheduler daemon was not loaded');
        }

        // Step 2: Stop Colima
        info('Stopping Colima...');
        await stopColima();
        success('Colima stopped');

        success('System is down');
      } catch (err) {
        handleError(err);
      }
    });
}
