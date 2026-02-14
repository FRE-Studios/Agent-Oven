/**
 * `agent-oven up` — Start Colima + daemon
 */

import * as fs from 'node:fs';
import { execa } from 'execa';
import type { Command } from 'commander';
import { requireConfig, handleError } from '../utils/errors.js';
import { getLaunchdPlistPath } from '../../core/config.js';
import { getColimaStatus, startColima, getSchedulerStatus } from '../../core/docker.js';
import { success, info } from '../utils/output.js';

export function register(program: Command): void {
  program
    .command('up')
    .description('Start Colima and the scheduler daemon')
    .action(async () => {
      try {
        const config = requireConfig();

        // Step 1: Colima
        const colima = await getColimaStatus();
        if (colima.running) {
          info('Colima is already running');
        } else {
          info('Starting Colima...');
          await startColima(config);
          success('Colima started');
        }

        // Step 2: Daemon
        const plistPath = getLaunchdPlistPath();
        if (!fs.existsSync(plistPath)) {
          info('Scheduler plist not found — skipping daemon. Run `agent-oven init` to set up.');
          return;
        }

        const sched = await getSchedulerStatus();
        if (sched.loaded) {
          info('Scheduler daemon is already loaded');
        } else {
          await execa('launchctl', ['load', plistPath]);
          success('Scheduler daemon started');
        }

        success('System is up');
      } catch (err) {
        handleError(err);
      }
    });
}
