/**
 * macOS (Darwin) platform adapter.
 *
 * Daemon:   launchd plist
 * Runtime:  Colima (Docker VM for macOS)
 * Packages: Homebrew
 */

import { execa } from 'execa';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { PlatformAdapter } from './platform.js';
import type { Config, RuntimeStatus, SchedulerStatus } from './types.js';
import { resolveSchedulerCommand } from './setup.js';

// ── Helpers ────────────────────────────────────────────────────

function escapePlistString(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapePlistString(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ── Adapter ────────────────────────────────────────────────────

export class DarwinAdapter implements PlatformAdapter {
  private readDaemonPlist(): string | null {
    const plistPath = this.getDaemonConfigPath();
    if (!fs.existsSync(plistPath)) {
      return null;
    }
    return fs.readFileSync(plistPath, 'utf-8');
  }

  private extractPlistString(content: string, key: string): string | null {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(
      new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`),
    );
    return match ? unescapePlistString(match[1]) : null;
  }

  // ── Daemon ──────────────────────────────────────────────────

  getDaemonConfigPath(): string {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.agent-oven.scheduler.plist');
  }

  daemonConfigExists(): boolean {
    return fs.existsSync(this.getDaemonConfigPath());
  }

  async getSchedulerStatus(): Promise<SchedulerStatus> {
    try {
      const { stdout } = await execa('launchctl', ['list'], { reject: false });
      const loaded = stdout.includes('com.agent-oven.scheduler');

      if (!loaded) {
        return { loaded: false };
      }

      try {
        const { stdout: detailOutput } = await execa(
          'launchctl',
          ['list', 'com.agent-oven.scheduler'],
          { reject: false },
        );
        const exitMatch = detailOutput.match(/LastExitStatus\s*=\s*(\d+)/);
        return {
          loaded: true,
          lastExitStatus: exitMatch ? parseInt(exitMatch[1], 10) : undefined,
        };
      } catch {
        return { loaded: true };
      }
    } catch {
      return { loaded: false };
    }
  }

  validateDaemonConfig(): string | null {
    const plistPath = this.getDaemonConfigPath();
    let content: string | null;
    try {
      content = this.readDaemonPlist();
    } catch {
      return `Unable to read daemon config at ${plistPath}`;
    }

    if (!content) {
      return null; // no config to validate
    }

    // Extract the first <string> inside <key>ProgramArguments</key><array>...</array>
    // which is the Node binary path.
    const progArgsMatch = content.match(
      /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/,
    );
    if (!progArgsMatch) {
      return null; // can't parse — skip validation
    }

    const nodePath = unescapePlistString(progArgsMatch[1]);
    if (!fs.existsSync(nodePath)) {
      return (
        `Daemon config references a Node binary that no longer exists: ${nodePath}\n` +
        'This typically happens after `brew upgrade node`. ' +
        'The daemon will be regenerated with the current Node path.'
      );
    }

    return null;
  }

  getDaemonProjectDir(): string | null {
    let content: string | null;
    try {
      content = this.readDaemonPlist();
    } catch {
      return null;
    }

    if (!content) {
      return null;
    }

    const logPath = this.extractPlistString(content, 'StandardOutPath');
    if (!logPath || !logPath.endsWith(path.join('logs', 'scheduler.log'))) {
      return null;
    }

    return path.dirname(path.dirname(logPath));
  }

  async installDaemon(projectDir: string): Promise<{ success: boolean; error?: string }> {
    const plistPath = this.getDaemonConfigPath();
    const plistDir = path.dirname(plistPath);

    try {
      if (!fs.existsSync(plistDir)) {
        fs.mkdirSync(plistDir, { recursive: true });
      }

      const content = await this.generateDaemonConfig(projectDir);
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

  async startDaemon(): Promise<void> {
    const plistPath = this.getDaemonConfigPath();
    await execa('launchctl', ['load', plistPath]);
  }

  async stopDaemon(): Promise<void> {
    const plistPath = this.getDaemonConfigPath();
    await execa('launchctl', ['unload', plistPath]);
  }

  async generateDaemonConfig(projectDir: string): Promise<string> {
    const cmdArgs = await resolveSchedulerCommand(projectDir);
    const programArgs = cmdArgs
      .map((arg) => `        <string>${escapePlistString(arg)}</string>`)
      .join('\n');
    const schedulerLogPath = escapePlistString(path.join(projectDir, 'logs', 'scheduler.log'));

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-oven.scheduler</string>

    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>

    <key>StartInterval</key>
    <integer>60</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${schedulerLogPath}</string>

    <key>StandardErrorPath</key>
    <string>${schedulerLogPath}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${escapePlistString(os.homedir())}</string>
    </dict>
</dict>
</plist>
`;
  }

  // ── Runtime (Colima) ────────────────────────────────────────

  async getRuntimeStatus(): Promise<RuntimeStatus> {
    try {
      const { stdout, stderr } = await execa('colima', ['status'], { reject: false });
      const output = stdout + '\n' + stderr;
      const running = output.includes('Running') || output.includes('is running');

      if (!running) {
        return { running: false };
      }

      // colima list --json provides structured resource info;
      // colima status only outputs log-style lines without CPU/memory/disk fields.
      let cpu: number | undefined;
      let memory: number | undefined;
      let disk: number | undefined;
      try {
        const { stdout: jsonOut } = await execa('colima', ['list', '--json'], { reject: false });
        if (jsonOut) {
          const info = JSON.parse(jsonOut);
          cpu = info.cpu ?? undefined;
          memory = info.memory ? Math.round(info.memory / (1024 * 1024 * 1024)) : undefined;
          disk = info.disk ? Math.round(info.disk / (1024 * 1024 * 1024)) : undefined;
        }
      } catch {
        // Resource info is informational only — not critical
      }

      return { running: true, cpu, memory, disk };
    } catch {
      return { running: false };
    }
  }

  async ensureRuntime(config: Config): Promise<void> {
    const status = await this.getRuntimeStatus();
    if (status.running) return;
    await this.startRuntime(config);
  }

  async startRuntime(config: Config): Promise<void> {
    const { cpu, memory, disk } = config.colima;
    await execa('colima', [
      'start',
      '--cpu', cpu.toString(),
      '--memory', memory.toString(),
      '--disk', disk.toString(),
    ]);
  }

  async stopRuntime(): Promise<void> {
    await execa('colima', ['stop']);
  }

  get needsVM(): boolean {
    return true;
  }

  // ── Packages (Homebrew) ─────────────────────────────────────

  async checkPackageManager(): Promise<{ available: boolean; version?: string }> {
    try {
      const { stdout } = await execa('brew', ['--version']);
      const version = stdout.split('\n')[0]?.replace('Homebrew ', '').trim();
      return { available: true, version };
    } catch {
      return { available: false };
    }
  }

  async installPackage(
    pkg: string,
    onOutput?: (line: string) => void,
  ): Promise<'installed' | 'already-installed' | 'failed'> {
    try {
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
    return ['colima', 'docker', 'jq'];
  }
}
