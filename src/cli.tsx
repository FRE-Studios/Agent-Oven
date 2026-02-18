#!/usr/bin/env node
/**
 * Agent Oven CLI Entry Point
 *
 * Routes to commander subcommands, TUI, or init wizard.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// If no arguments, skip commander entirely and launch TUI directly
if (process.argv.length <= 2) {
  await launchTUI();
  // launchTUI waits until exit, so this won't reach below
} else {
  const program = new Command();

  program
    .name('agent-oven')
    .description('Job scheduler for Docker containers (macOS and Linux)')
    .version(version);

  // Register all CLI commands
  const commandModules = [
    () => import('./cli/commands/status.js'),
    () => import('./cli/commands/list.js'),
    () => import('./cli/commands/add.js'),
    () => import('./cli/commands/show.js'),
    () => import('./cli/commands/run.js'),
    () => import('./cli/commands/delete.js'),
    () => import('./cli/commands/toggle.js'),
    () => import('./cli/commands/logs.js'),
    () => import('./cli/commands/daemon.js'),
    () => import('./cli/commands/up.js'),
    () => import('./cli/commands/down.js'),
    () => import('./cli/commands/scheduler-tick.js'),
  ];

  for (const load of commandModules) {
    const mod = await load();
    mod.register(program);
  }

  // `agent-oven init` — interactive setup wizard
  program
    .command('init')
    .description('Run the interactive setup wizard')
    .action(async () => {
      const React = (await import('react')).default;
      const { render } = await import('ink');
      const { InitWizard } = await import('./tui/components/InitWizard.js');
      const { waitUntilExit } = render(<InitWizard />);
      await waitUntilExit();
    });

  // `agent-oven tui` — explicit TUI launch
  program
    .command('tui')
    .description('Launch the interactive terminal UI')
    .action(async () => {
      await launchTUI();
    });

  await program.parseAsync();
}

async function launchTUI(): Promise<void> {
  const React = (await import('react')).default;
  const { render } = await import('ink');
  const { App } = await import('./tui/App.js');
  const { loadConfig } = await import('./core/config.js');
  const config = loadConfig();
  const { waitUntilExit } = render(<App config={config} />);
  await waitUntilExit();
}
