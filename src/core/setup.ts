/**
 * Setup logic for Agent Oven init wizard
 * All functions are idempotent — they check state before acting.
 */

import { execa } from 'execa';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getColimaStatus, startColima, isDockerAvailable } from './docker.js';
import { saveConfig, getLaunchdPlistPath } from './config.js';
import type { Config } from './types.js';

export { getColimaStatus, startColima, isDockerAvailable };

export interface DependencyStatus {
  installed: boolean;
  version?: string;
}

/**
 * Check if Homebrew is installed
 */
export async function checkHomebrew(): Promise<DependencyStatus> {
  try {
    const { stdout } = await execa('brew', ['--version']);
    const version = stdout.split('\n')[0]?.replace('Homebrew ', '').trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Check if a command-line dependency exists
 */
export async function checkDependency(name: string): Promise<DependencyStatus> {
  try {
    await execa('command', ['-v', name], { shell: true });

    // Try to get version
    let version: string | undefined;
    try {
      const { stdout } = await execa(name, ['--version'], { reject: false });
      version = stdout.split('\n')[0]?.trim();
    } catch {
      // Some commands don't have --version
    }

    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Install a package via Homebrew
 */
export async function brewInstall(
  pkg: string,
  onOutput?: (line: string) => void,
): Promise<'installed' | 'already-installed' | 'failed'> {
  try {
    // Check if already installed
    const check = await execa('brew', ['list', pkg], { reject: false });
    if (check.exitCode === 0) {
      return 'already-installed';
    }

    const proc = execa('brew', ['install', pkg]);

    if (onOutput && proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          onOutput(line);
        }
      });
    }
    if (onOutput && proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          onOutput(line);
        }
      });
    }

    await proc;
    return 'installed';
  } catch {
    return 'failed';
  }
}

/**
 * Create required directories and files
 */
export function setupFiles(projectDir: string): { created: string[]; existed: string[] } {
  const created: string[] = [];
  const existed: string[] = [];

  const dirs = [
    path.join(projectDir, 'logs'),
    path.join(projectDir, 'logs', 'jobs'),
  ];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      existed.push(dir);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  const jobsFile = path.join(projectDir, 'jobs.json');
  if (fs.existsSync(jobsFile)) {
    existed.push(jobsFile);
  } else {
    fs.writeFileSync(jobsFile, JSON.stringify({ jobs: [] }, null, 2) + '\n');
    created.push(jobsFile);
  }

  return { created, existed };
}

/**
 * Scan images/ directory for subdirs containing Dockerfiles
 */
export function discoverImages(projectDir: string): string[] {
  const imagesDir = path.join(projectDir, 'images');
  if (!fs.existsSync(imagesDir)) {
    return [];
  }

  return fs.readdirSync(imagesDir)
    .filter((name) => {
      const dir = path.join(imagesDir, name);
      return fs.statSync(dir).isDirectory() &&
        fs.existsSync(path.join(dir, 'Dockerfile'));
    });
}

/**
 * Build a Docker image from the images/ directory
 */
export async function buildImage(
  projectDir: string,
  imageName: string,
  onOutput?: (line: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const contextDir = path.join(projectDir, 'images', imageName);
  const tag = `agent-oven/${imageName}`;

  try {
    const proc = execa('docker', ['build', '-t', tag, contextDir]);

    if (onOutput && proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          onOutput(line);
        }
      });
    }
    if (onOutput && proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          onOutput(line);
        }
      });
    }

    await proc;
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Detect the system timezone
 */
export function detectTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Generate launchd plist XML content
 */
export function generatePlistContent(projectDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-oven.scheduler</string>

    <key>ProgramArguments</key>
    <array>
        <string>${projectDir}/scheduler.sh</string>
    </array>

    <key>StartInterval</key>
    <integer>60</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${projectDir}/logs/scheduler.log</string>

    <key>StandardErrorPath</key>
    <string>${projectDir}/logs/scheduler.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`;
}

/**
 * Install the launchd agent
 */
export async function installLaunchd(projectDir: string): Promise<{ success: boolean; error?: string }> {
  const plistPath = getLaunchdPlistPath();
  const plistDir = path.dirname(plistPath);

  try {
    // Ensure LaunchAgents directory exists
    if (!fs.existsSync(plistDir)) {
      fs.mkdirSync(plistDir, { recursive: true });
    }

    // Write plist
    const content = generatePlistContent(projectDir);
    fs.writeFileSync(plistPath, content);

    // Unload if already loaded (ignore errors)
    await execa('launchctl', ['unload', plistPath], { reject: false });

    // Load the agent
    await execa('launchctl', ['load', plistPath]);

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Verify Docker is available and get version
 */
export async function verifyDocker(): Promise<{ available: boolean; version?: string }> {
  try {
    const infoResult = await execa('docker', ['info'], { reject: false });
    if (infoResult.exitCode !== 0) {
      return { available: false };
    }

    const { stdout } = await execa('docker', ['version', '--format', '{{.Server.Version}}'], { reject: false });
    return { available: true, version: stdout.trim() || undefined };
  } catch {
    return { available: false };
  }
}

/**
 * Build and save a full Config object from wizard selections
 */
export function buildConfig(opts: {
  projectDir: string;
  cpu: number;
  memory: number;
  disk: number;
  timezone: string;
}): Config {
  const config: Config = {
    projectDir: opts.projectDir,
    colima: {
      cpu: opts.cpu,
      memory: opts.memory,
      disk: opts.disk,
    },
    docker: {
      defaultCpus: 1,
      defaultMemory: '512m',
    },
    timezone: opts.timezone,
    auth: {
      defaultMode: 'host-login',
      claudeCredPath: path.join(os.homedir(), '.claude'),
      ghCredPath: path.join(os.homedir(), '.config', 'gh'),
    },
  };

  saveConfig(config);
  return config;
}
