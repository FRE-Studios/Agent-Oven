/**
 * Linux platform adapter.
 *
 * Daemon:   systemd user service + timer
 * Runtime:  Native Docker (no VM needed)
 * Packages: No package manager integration (user pre-installs Docker)
 */

import { execa } from 'execa';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { PlatformAdapter } from './platform.js';
import type { Config, RuntimeStatus, SchedulerStatus } from './types.js';
import { resolveSchedulerCommand } from './setup.js';

// ── Constants ──────────────────────────────────────────────────

const SERVICE_NAME = 'agent-oven-scheduler';
const TIMER_NAME = 'agent-oven-scheduler';

function getSystemdUserDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'systemd', 'user');
  }
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function escapeSystemdArg(arg: string): string {
  // systemd treats % as a specifier marker; escape to preserve literal values.
  const escaped = arg
    .replace(/%/g, '%%')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  if (escaped.length === 0 || /[\s"]/u.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function escapeSystemdValue(value: string): string {
  const escaped = value
    .replace(/%/g, '%%')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ── Adapter ────────────────────────────────────────────────────

export class LinuxAdapter implements PlatformAdapter {
  // ── Daemon (systemd) ────────────────────────────────────────

  getDaemonConfigPath(): string {
    return path.join(getSystemdUserDir(), `${TIMER_NAME}.timer`);
  }

  daemonConfigExists(): boolean {
    const dir = getSystemdUserDir();
    return (
      fs.existsSync(path.join(dir, `${SERVICE_NAME}.service`)) &&
      fs.existsSync(path.join(dir, `${TIMER_NAME}.timer`))
    );
  }

  async getSchedulerStatus(): Promise<SchedulerStatus> {
    try {
      const { stdout, exitCode } = await execa(
        'systemctl',
        ['--user', 'is-active', `${TIMER_NAME}.timer`],
        { reject: false },
      );

      const isActive = exitCode === 0 && stdout.trim() === 'active';

      if (!isActive) {
        return { loaded: false };
      }

      // Try to get last service exit status
      try {
        const { stdout: showOutput } = await execa(
          'systemctl',
          ['--user', 'show', `${SERVICE_NAME}.service`, '--property=ExecMainStatus'],
          { reject: false },
        );
        const match = showOutput.match(/ExecMainStatus=(\d+)/);
        return {
          loaded: true,
          lastExitStatus: match ? parseInt(match[1], 10) : undefined,
        };
      } catch {
        return { loaded: true };
      }
    } catch {
      return { loaded: false };
    }
  }

  async installDaemon(projectDir: string): Promise<{ success: boolean; error?: string }> {
    const unitDir = getSystemdUserDir();

    try {
      if (!fs.existsSync(unitDir)) {
        fs.mkdirSync(unitDir, { recursive: true });
      }

      // Generate and write both unit files
      const config = await this.generateDaemonConfig(projectDir);
      const [serviceContent, timerContent] = config.split('\n---\n');

      fs.writeFileSync(path.join(unitDir, `${SERVICE_NAME}.service`), serviceContent);
      fs.writeFileSync(path.join(unitDir, `${TIMER_NAME}.timer`), timerContent);

      // Reload systemd, enable and start the timer
      await execa('systemctl', ['--user', 'daemon-reload']);
      await execa('systemctl', ['--user', 'enable', '--now', `${TIMER_NAME}.timer`]);

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  async startDaemon(): Promise<void> {
    await execa('systemctl', ['--user', 'start', `${TIMER_NAME}.timer`]);
  }

  async stopDaemon(): Promise<void> {
    await execa('systemctl', ['--user', 'stop', `${TIMER_NAME}.timer`]);
  }

  async generateDaemonConfig(projectDir: string): Promise<string> {
    const cmdArgs = await resolveSchedulerCommand(projectDir, {
      allowLegacyFallback: false,
    });
    const execStart = cmdArgs.map(escapeSystemdArg).join(' ');
    const schedulerLogPath = path.join(projectDir, 'logs', 'scheduler.log');
    const logOutput = escapeSystemdValue(`append:${schedulerLogPath}`);

    const serviceUnit = `[Unit]
Description=Agent Oven Scheduler (one-shot tick)

[Service]
Type=oneshot
ExecStart=${execStart}
StandardOutput=${logOutput}
StandardError=${logOutput}
`;

    const timerUnit = `[Unit]
Description=Agent Oven Scheduler Timer

[Timer]
OnBootSec=60s
OnUnitActiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
`;

    // Joined with a separator so both can be returned from a single call.
    // installDaemon() splits on this separator.
    return `${serviceUnit}\n---\n${timerUnit}`;
  }

  // ── Runtime (native Docker) ─────────────────────────────────

  async getRuntimeStatus(): Promise<RuntimeStatus> {
    try {
      const { exitCode } = await execa('docker', ['info'], { reject: false });
      return { running: exitCode === 0 };
    } catch {
      return { running: false };
    }
  }

  async ensureRuntime(_config: Config): Promise<void> {
    const status = await this.getRuntimeStatus();
    if (status.running) return;
    throw new Error(
      'Docker is not running. On Linux, start Docker with: sudo systemctl start docker',
    );
  }

  async startRuntime(_config: Config): Promise<void> {
    // On Linux Docker is a system service — we can't start it without root.
    // Just verify it's up.
    const status = await this.getRuntimeStatus();
    if (!status.running) {
      throw new Error(
        'Docker is not running. Start it with: sudo systemctl start docker',
      );
    }
  }

  async stopRuntime(): Promise<void> {
    // Docker on Linux is a system service — stopping it requires root
    // and would affect all users. This is intentionally a no-op.
  }

  get needsVM(): boolean {
    return false;
  }

  // ── Packages ────────────────────────────────────────────────

  async checkPackageManager(): Promise<{ available: boolean; version?: string }> {
    // Linux has no single package manager we depend on.
    // Always return available since install is a no-op.
    return { available: true };
  }

  async installPackage(
    _pkg: string,
    _onOutput?: (line: string) => void,
  ): Promise<'installed' | 'already-installed' | 'failed'> {
    // On Linux, users pre-install Docker themselves.
    // Check if the package is available as a command.
    const check = await this.checkDependency(_pkg);
    return check.installed ? 'already-installed' : 'failed';
  }

  async checkDependency(name: string): Promise<{ installed: boolean; version?: string }> {
    try {
      await execa('command', ['-v', name], { shell: true });

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

  get prerequisites(): string[] {
    return ['docker', 'jq'];
  }
}
