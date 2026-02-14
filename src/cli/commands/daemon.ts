/**
 * `agent-oven daemon <action>` — Manage the scheduler daemon
 */

import * as fs from 'node:fs';
import { execa } from 'execa';
import type { Command } from 'commander';
import { handleError } from '../utils/errors.js';
import { getLaunchdPlistPath } from '../../core/config.js';
import { getSchedulerStatus } from '../../core/docker.js';
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
        const plistPath = getLaunchdPlistPath();
        const plistExists = fs.existsSync(plistPath);
        const status = await getSchedulerStatus();

        console.log('\nScheduler Daemon');
        console.log(`  Plist:    ${plistExists ? statusIcon(true) + ' ' + plistPath : statusIcon(false) + ' Not found'}`);
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
        const plistPath = getLaunchdPlistPath();
        if (!fs.existsSync(plistPath)) {
          error(`Plist not found at ${plistPath}. Run \`agent-oven init\` first.`);
          process.exit(1);
        }

        const status = await getSchedulerStatus();
        if (status.loaded) {
          info('Daemon is already loaded');
          return;
        }

        await execa('launchctl', ['load', plistPath]);
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
        const plistPath = getLaunchdPlistPath();
        const status = await getSchedulerStatus();

        if (!status.loaded) {
          info('Daemon is not loaded');
          return;
        }

        await execa('launchctl', ['unload', plistPath]);
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
        const plistPath = getLaunchdPlistPath();
        if (!fs.existsSync(plistPath)) {
          error(`Plist not found at ${plistPath}. Run \`agent-oven init\` first.`);
          process.exit(1);
        }

        const status = await getSchedulerStatus();
        if (status.loaded) {
          await execa('launchctl', ['unload', plistPath]);
          info('Daemon stopped');
        }

        await execa('launchctl', ['load', plistPath]);
        success('Daemon started');
      } catch (err) {
        handleError(err);
      }
    });
}
