/**
 * Configuration management for Agent Oven
 * Follows XDG Base Directory Specification
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Config, ColimaConfig, DockerDefaults } from './types.js';

/** Default Colima configuration */
const DEFAULT_COLIMA: ColimaConfig = {
  cpu: 2,
  memory: 4,
  disk: 20,
};

/** Default Docker resource limits */
const DEFAULT_DOCKER: DockerDefaults = {
  defaultCpus: 1,
  defaultMemory: '512m',
};

/** Default configuration */
const DEFAULT_CONFIG: Omit<Config, 'projectDir'> = {
  colima: DEFAULT_COLIMA,
  docker: DEFAULT_DOCKER,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

/**
 * Get the XDG config directory
 */
function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'agent-oven');
  }
  return path.join(os.homedir(), '.config', 'agent-oven');
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Try to auto-detect the project directory
 * Looks for common indicators of the agent-oven project
 */
function detectProjectDir(): string | null {
  // Check if running from within the project
  const cwd = process.cwd();
  if (isProjectDir(cwd)) {
    return cwd;
  }

  // Check common locations
  const candidates = [
    path.join(os.homedir(), 'agent-oven'),
    path.join(os.homedir(), 'Developer', 'agent-oven'),
    path.join(os.homedir(), 'Projects', 'agent-oven'),
    '/opt/agent-oven',
  ];

  for (const candidate of candidates) {
    if (isProjectDir(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Check if a directory looks like the agent-oven project
 */
function isProjectDir(dir: string): boolean {
  try {
    const hasJobsFile = fs.existsSync(path.join(dir, 'jobs.json'));
    const hasScheduler = fs.existsSync(path.join(dir, 'scheduler.sh'));
    return hasJobsFile || hasScheduler;
  } catch {
    return false;
  }
}

/**
 * Load configuration from disk
 * Creates default config if none exists
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  let savedConfig: Partial<Config> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      savedConfig = JSON.parse(content);
    } catch (err) {
      console.error(`Warning: Failed to parse config at ${configPath}:`, err);
    }
  }

  // Determine project directory
  let projectDir = savedConfig.projectDir;
  if (!projectDir || !fs.existsSync(projectDir)) {
    projectDir = detectProjectDir() ?? process.cwd();
  }

  // Merge with defaults
  const config: Config = {
    projectDir,
    colima: { ...DEFAULT_COLIMA, ...savedConfig.colima },
    docker: { ...DEFAULT_DOCKER, ...savedConfig.docker },
    timezone: savedConfig.timezone ?? DEFAULT_CONFIG.timezone,
  };

  return config;
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: Config): void {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Get the path to jobs.json
 */
export function getJobsFilePath(config: Config): string {
  return path.join(config.projectDir, 'jobs.json');
}

/**
 * Get the path to the logs directory
 */
export function getLogsDir(config: Config): string {
  return path.join(config.projectDir, 'logs');
}

/**
 * Get the path to a specific job's log directory
 */
export function getJobLogsDir(config: Config, jobId: string): string {
  return path.join(getLogsDir(config), 'jobs', jobId);
}

/**
 * Get the path to the scheduler log
 */
export function getSchedulerLogPath(config: Config): string {
  return path.join(getLogsDir(config), 'scheduler.log');
}

/**
 * Get the launchd plist path
 */
export function getLaunchdPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.agent-oven.scheduler.plist');
}

/**
 * Update specific config values
 */
export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();
  const updated: Config = {
    ...current,
    ...updates,
    colima: { ...current.colima, ...updates.colima },
    docker: { ...current.docker, ...updates.docker },
  };
  saveConfig(updated);
  return updated;
}

/**
 * Get default configuration (useful for initialization)
 */
export function getDefaultConfig(): Omit<Config, 'projectDir'> {
  return { ...DEFAULT_CONFIG };
}
