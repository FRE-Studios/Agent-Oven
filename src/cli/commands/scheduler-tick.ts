/**
 * `agent-oven scheduler-tick` — Run one scheduler cycle (internal, called by launchd)
 *
 * Hidden from `--help` output. This is the TypeScript replacement for scheduler.sh.
 */

import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { runSchedulerTick } from '../../core/scheduler-runner.js';

export function register(program: Command): void {
  program
    .command('scheduler-tick', { hidden: true })
    .description('Run one scheduler cycle (called by launchd)')
    .action(async () => {
      const config = loadConfig();
      const exitCode = await runSchedulerTick(config);
      process.exit(exitCode);
    });
}
