/**
 * Setup logic for Agent Oven init wizard
 * All functions are idempotent — they check state before acting.
 */

import { execa } from 'execa';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDockerAvailable } from './docker.js';
import { saveConfig } from './config.js';
import type { Config } from './types.js';

export { isDockerAvailable };

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
 * Resolve the command array for the daemon config (plist/systemd ExecStart).
 *
 * Strategy:
 *  1. Pin to the currently-running CLI process where possible.
 *  2. Fallback to project-local dist/cli.js (for built source checkouts).
 *  3. Fallback to package-local dist/cli.js (for npm global installs).
 *  4. Optional final fallback: legacy scheduler.sh for unbuilt source checkouts.
 */
export async function resolveSchedulerCommand(
  projectDir: string,
  options?: { allowLegacyFallback?: boolean },
): Promise<string[]> {
  const allowLegacyFallback = options?.allowLegacyFallback ?? true;

  // 1) Pin to the current CLI invocation path when possible.
  const argv1 = process.argv[1];
  if (argv1) {
    const invokedPath = path.isAbsolute(argv1) ? argv1 : path.resolve(process.cwd(), argv1);
    if (fs.existsSync(invokedPath)) {
      const ext = path.extname(invokedPath).toLowerCase();
      if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        return [process.execPath, invokedPath, 'scheduler-tick'];
      }
    }
  }

  // 2) Project-local build output.
  const projectCliJs = path.resolve(projectDir, 'dist', 'cli.js');
  if (fs.existsSync(projectCliJs)) {
    return [process.execPath, projectCliJs, 'scheduler-tick'];
  }

  // 3) Package-local build output (works for npm/global installs).
  const packageCliJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
  if (fs.existsSync(packageCliJs)) {
    return [process.execPath, packageCliJs, 'scheduler-tick'];
  }

  // 4) Optional legacy fallback for source checkouts not yet built.
  const legacyScheduler = path.resolve(projectDir, 'scheduler.sh');
  if (allowLegacyFallback && fs.existsSync(legacyScheduler)) {
    return [legacyScheduler];
  }

  const lookedFor = `${projectCliJs}, ${packageCliJs}, and ${legacyScheduler}`;
  if (!allowLegacyFallback) {
    throw new Error(
      `Unable to resolve scheduler command for this platform. Looked for ${lookedFor}. ` +
      'Build the project first so dist/cli.js exists (for example: npm run build).',
    );
  }

  throw new Error(
    `Unable to resolve scheduler command. Looked for ${lookedFor}.`
  );
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
