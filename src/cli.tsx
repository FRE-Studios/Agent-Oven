#!/usr/bin/env node
/**
 * Agent Oven CLI Entry Point
 */

import React from 'react';
import { render } from 'ink';

const command = process.argv[2];

if (command === 'init') {
  const { InitWizard } = await import('./tui/components/InitWizard.js');
  const { waitUntilExit } = render(<InitWizard />);
  await waitUntilExit();
} else {
  const { App } = await import('./tui/App.js');
  const { loadConfig } = await import('./core/config.js');
  const config = loadConfig();
  const { waitUntilExit } = render(<App config={config} />);
  await waitUntilExit();
}
