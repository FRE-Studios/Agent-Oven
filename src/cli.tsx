#!/usr/bin/env node
/**
 * Agent Oven CLI Entry Point
 */

import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { loadConfig } from './core/config.js';

// Load configuration
const config = loadConfig();

// Render the TUI
const { waitUntilExit } = render(<App config={config} />);

// Wait for the app to exit
await waitUntilExit();
