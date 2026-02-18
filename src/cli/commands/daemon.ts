/**
 * `agent-oven daemon <action>` — Manage the scheduler daemon
 */

import type { Command } from 'commander';
import { handleError } from '../utils/errors.js';
import { platform } from '../../core/platform.js';
import { success, error, info, statusIcon } from '../utils/output.js';

export function register(program: Command): void {
  const cmd = program
    .command('daemon')
    .description('Manage the scheduler daemon');

  cmd
    .command('status')
    .description('Show daemon status')
    .action(async () => {
      try {
        const configPath = platform.getDaemonConfigPath();
        const configExists = platform.daemonConfigExists();
        const status = await platform.getSchedulerStatus();

        console.log('\nScheduler Daemon');
        console.log(`  Config:   ${configExists ? statusIcon(true) + ' ' + configPath : statusIcon(false) + ' Not found'}`);
        console.log(`  Loaded:   ${statusIcon(status.loaded)} ${status.loaded ? 'Yes' : 'No'}`);
        if (status.lastExitStatus !== undefined) {
          console.log(`  Last exit: ${status.lastExitStatus}`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  cmd
    .command('start')
    .description('Start the scheduler daemon')
    .action(async () => {
      try {
        if (!platform.daemonConfigExists()) {
          error(`Daemon config not found at ${platform.getDaemonConfigPath()}. Run \`agent-oven init\` first.`);
          process.exit(1);
        }

        const status = await platform.getSchedulerStatus();
        if (status.loaded) {
          info('Daemon is already loaded');
          return;
        }

        await platform.startDaemon();
        success('Daemon started');
      } catch (err) {
        handleError(err);
      }
    });

  cmd
    .command('stop')
    .description('Stop the scheduler daemon')
    .action(async () => {
      try {
        const status = await platform.getSchedulerStatus();

        if (!status.loaded) {
          info('Daemon is not loaded');
          return;
        }

        await platform.stopDaemon();
        success('Daemon stopped');
      } catch (err) {
        handleError(err);
      }
    });

  cmd
    .command('restart')
    .description('Restart the scheduler daemon')
    .action(async () => {
      try {
        if (!platform.daemonConfigExists()) {
          error(`Daemon config not found at ${platform.getDaemonConfigPath()}. Run \`agent-oven init\` first.`);
          process.exit(1);
        }

        const status = await platform.getSchedulerStatus();
        if (status.loaded) {
          await platform.stopDaemon();
          info('Daemon stopped');
        }

        await platform.startDaemon();
        success('Daemon started');
      } catch (err) {
        handleError(err);
      }
    });
}
