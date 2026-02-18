/**
 * Platform adapter — abstracts OS-specific daemon, runtime, and package operations.
 *
 * Usage:
 *   import { platform } from './platform.js';
 *   await platform.startDaemon();
 *
 * For testing, use the factory directly:
 *   import { getPlatformAdapter } from './platform.js';
 *   const adapter = getPlatformAdapter('linux');
 */

import type { Config, RuntimeStatus, SchedulerStatus } from './types.js';
import { DarwinAdapter } from './platform-darwin.js';
import { LinuxAdapter } from './platform-linux.js';

export interface PlatformAdapter {
  // ── Daemon (launchd / systemd) ──────────────────────────────
  /** Filesystem path to the daemon config (plist or systemd unit). */
  getDaemonConfigPath(): string;
  /** Whether the daemon config file exists on disk. */
  daemonConfigExists(): boolean;
  /** Query the daemon scheduler status. */
  getSchedulerStatus(): Promise<SchedulerStatus>;
  /** Write config files + load the daemon for the first time. */
  installDaemon(projectDir: string): Promise<{ success: boolean; error?: string }>;
  /** Start (load) the daemon. */
  startDaemon(): Promise<void>;
  /** Stop (unload) the daemon. */
  stopDaemon(): Promise<void>;
  /** Generate the daemon config content (for inspection / testing). */
  generateDaemonConfig(projectDir: string): Promise<string>;

  // ── Container runtime (Colima / native Docker) ──────────────
  /** Current runtime status. */
  getRuntimeStatus(): Promise<RuntimeStatus>;
  /** Ensure the runtime is available, starting it if needed. */
  ensureRuntime(config: Config): Promise<void>;
  /** Explicitly start the runtime. */
  startRuntime(config: Config): Promise<void>;
  /** Explicitly stop the runtime. */
  stopRuntime(): Promise<void>;
  /** Whether this platform needs a VM to run Docker. */
  readonly needsVM: boolean;

  // ── Package management ──────────────────────────────────────
  /** Check whether the platform package manager is available. */
  checkPackageManager(): Promise<{ available: boolean; version?: string }>;
  /** Install a package. */
  installPackage(pkg: string, onOutput?: (line: string) => void): Promise<'installed' | 'already-installed' | 'failed'>;
  /** Check if a CLI dependency is available. */
  checkDependency(name: string): Promise<{ installed: boolean; version?: string }>;
  /** Prerequisite package names to check during init. */
  readonly prerequisites: string[];
}

/**
 * Create the correct adapter for the given platform.
 * Accepts an optional override for testing.
 */
export function getPlatformAdapter(platformOverride?: string): PlatformAdapter {
  const plat = platformOverride ?? process.platform;

  switch (plat) {
    case 'darwin':
      return new DarwinAdapter();
    case 'linux':
      return new LinuxAdapter();
    default:
      throw new Error(`Unsupported platform: ${plat}. Agent Oven supports macOS (darwin) and Linux.`);
  }
}

/** Module-level singleton for production use. */
export const platform: PlatformAdapter = getPlatformAdapter();
