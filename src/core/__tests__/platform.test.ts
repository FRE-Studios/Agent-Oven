import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa before importing adapters
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock fs for daemon config checks
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
}));

// Mock setup.ts to avoid importing docker.js and its dependencies
vi.mock('../setup.js', () => ({
  resolveSchedulerCommand: vi.fn(async () => ['/usr/bin/node', '/opt/agent-oven/dist/cli.js', 'scheduler-tick']),
  isDockerAvailable: vi.fn(async () => true),
}));

// Mock config.js
vi.mock('../config.js', () => ({
  saveConfig: vi.fn(),
}));

import { execa } from 'execa';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DarwinAdapter } from '../platform-darwin.js';
import { LinuxAdapter } from '../platform-linux.js';
import { getPlatformAdapter } from '../platform.js';
import { resolveSchedulerCommand } from '../setup.js';

const mockedExeca = vi.mocked(execa);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedResolveSchedulerCommand = vi.mocked(resolveSchedulerCommand);

// ─── Factory ─────────────────────────────────────────────────

describe('getPlatformAdapter', () => {
  it('returns DarwinAdapter for "darwin"', () => {
    const adapter = getPlatformAdapter('darwin');
    expect(adapter).toBeInstanceOf(DarwinAdapter);
  });

  it('returns LinuxAdapter for "linux"', () => {
    const adapter = getPlatformAdapter('linux');
    expect(adapter).toBeInstanceOf(LinuxAdapter);
  });

  it('throws for unsupported platform', () => {
    expect(() => getPlatformAdapter('win32')).toThrow('Unsupported platform: win32');
  });
});

// ─── DarwinAdapter ───────────────────────────────────────────

describe('DarwinAdapter', () => {
  let adapter: DarwinAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    adapter = new DarwinAdapter();
  });

  describe('getDaemonConfigPath', () => {
    it('returns the launchd plist path', () => {
      const expected = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.agent-oven.scheduler.plist');
      expect(adapter.getDaemonConfigPath()).toBe(expected);
    });
  });

  describe('daemonConfigExists', () => {
    it('returns true when plist exists', () => {
      mockedExistsSync.mockReturnValue(true);
      expect(adapter.daemonConfigExists()).toBe(true);
    });

    it('returns false when plist does not exist', () => {
      mockedExistsSync.mockReturnValue(false);
      expect(adapter.daemonConfigExists()).toBe(false);
    });
  });

  describe('getSchedulerStatus', () => {
    it('returns loaded: false when launchctl list has no match', async () => {
      mockedExeca.mockResolvedValue({ stdout: 'some other stuff' } as any);
      const status = await adapter.getSchedulerStatus();
      expect(status.loaded).toBe(false);
    });

    it('returns loaded: true when launchctl list includes agent-oven', async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: '123\t0\tcom.agent-oven.scheduler' } as any)
        .mockResolvedValueOnce({ stdout: 'LastExitStatus = 0;' } as any);
      const status = await adapter.getSchedulerStatus();
      expect(status.loaded).toBe(true);
      expect(status.lastExitStatus).toBe(0);
    });
  });

  describe('generateDaemonConfig', () => {
    it('generates valid plist XML', async () => {
      const content = await adapter.generateDaemonConfig('/opt/agent-oven');
      expect(content).toContain('<?xml version="1.0"');
      expect(content).toContain('com.agent-oven.scheduler');
      expect(content).toContain('StartInterval');
      expect(content).toContain('<integer>60</integer>');
      expect(content).toContain('scheduler-tick');
      expect(content).toContain('/opt/agent-oven/logs/scheduler.log');
    });
  });

  describe('getRuntimeStatus', () => {
    it('returns running: true when colima is running', async () => {
      mockedExeca.mockResolvedValue({
        stdout: 'INFO[0000] colima is Running\nCPU: 4\nMemory: 8\nDisk: 60',
      } as any);
      const status = await adapter.getRuntimeStatus();
      expect(status.running).toBe(true);
      expect(status.cpu).toBe(4);
      expect(status.memory).toBe(8);
      expect(status.disk).toBe(60);
    });

    it('returns running: false when colima is not running', async () => {
      mockedExeca.mockResolvedValue({ stdout: 'colima is not running' } as any);
      const status = await adapter.getRuntimeStatus();
      expect(status.running).toBe(false);
    });

    it('returns running: false when colima throws', async () => {
      mockedExeca.mockRejectedValue(new Error('command not found'));
      const status = await adapter.getRuntimeStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('needsVM', () => {
    it('returns true', () => {
      expect(adapter.needsVM).toBe(true);
    });
  });

  describe('prerequisites', () => {
    it('includes colima, docker, and jq', () => {
      expect(adapter.prerequisites).toEqual(['colima', 'docker', 'jq']);
    });
  });

  describe('checkPackageManager', () => {
    it('returns available: true when brew exists', async () => {
      mockedExeca.mockResolvedValue({ stdout: 'Homebrew 4.2.0' } as any);
      const result = await adapter.checkPackageManager();
      expect(result.available).toBe(true);
      expect(result.version).toBe('4.2.0');
    });

    it('returns available: false when brew is missing', async () => {
      mockedExeca.mockRejectedValue(new Error('not found'));
      const result = await adapter.checkPackageManager();
      expect(result.available).toBe(false);
    });
  });
});

// ─── LinuxAdapter ────────────────────────────────────────────

describe('LinuxAdapter', () => {
  let adapter: LinuxAdapter;

  beforeEach(() => {
    vi.resetAllMocks();
    adapter = new LinuxAdapter();
  });

  describe('getDaemonConfigPath', () => {
    it('returns systemd user timer path', () => {
      const expected = path.join(os.homedir(), '.config', 'systemd', 'user', 'agent-oven-scheduler.timer');
      expect(adapter.getDaemonConfigPath()).toBe(expected);
    });
  });

  describe('daemonConfigExists', () => {
    it('returns true when both service and timer exist', () => {
      mockedExistsSync.mockReturnValue(true);
      expect(adapter.daemonConfigExists()).toBe(true);
    });

    it('returns false when files are missing', () => {
      mockedExistsSync.mockReturnValue(false);
      expect(adapter.daemonConfigExists()).toBe(false);
    });
  });

  describe('getSchedulerStatus', () => {
    it('returns loaded: true when timer is active', async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: 'active', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: 'ExecMainStatus=0' } as any);
      const status = await adapter.getSchedulerStatus();
      expect(status.loaded).toBe(true);
      expect(status.lastExitStatus).toBe(0);
    });

    it('returns loaded: false when timer is inactive', async () => {
      mockedExeca.mockResolvedValue({ stdout: 'inactive', exitCode: 3 } as any);
      const status = await adapter.getSchedulerStatus();
      expect(status.loaded).toBe(false);
    });
  });

  describe('generateDaemonConfig', () => {
    it('generates systemd service and timer units', async () => {
      const content = await adapter.generateDaemonConfig('/opt/agent-oven');
      expect(content).toContain('[Unit]');
      expect(content).toContain('[Service]');
      expect(content).toContain('Type=oneshot');
      expect(content).toContain('scheduler-tick');
      expect(content).toContain('[Timer]');
      expect(content).toContain('OnUnitActiveSec=60s');
      expect(content).toContain('timers.target');
      expect(content).toContain('/opt/agent-oven/logs/scheduler.log');
    });

    it('contains the separator used by installDaemon', async () => {
      const content = await adapter.generateDaemonConfig('/opt/agent-oven');
      expect(content).toContain('\n---\n');
    });

    it('quotes ExecStart args and log paths when they contain spaces', async () => {
      mockedResolveSchedulerCommand.mockResolvedValueOnce([
        '/usr/bin/node',
        '/opt/agent oven/dist/cli.js',
        'scheduler-tick',
      ]);

      const content = await adapter.generateDaemonConfig('/opt/agent oven');
      expect(content).toContain(
        'ExecStart=/usr/bin/node "/opt/agent oven/dist/cli.js" scheduler-tick',
      );
      expect(content).toContain('StandardOutput="append:/opt/agent oven/logs/scheduler.log"');
      expect(content).toContain('StandardError="append:/opt/agent oven/logs/scheduler.log"');
    });

    it('disables legacy scheduler fallback on Linux', async () => {
      await adapter.generateDaemonConfig('/opt/agent-oven');
      expect(mockedResolveSchedulerCommand).toHaveBeenCalledWith('/opt/agent-oven', {
        allowLegacyFallback: false,
      });
    });
  });

  describe('getRuntimeStatus', () => {
    it('returns running: true when docker info succeeds', async () => {
      mockedExeca.mockResolvedValue({ exitCode: 0 } as any);
      const status = await adapter.getRuntimeStatus();
      expect(status.running).toBe(true);
    });

    it('returns running: false when docker info fails', async () => {
      mockedExeca.mockResolvedValue({ exitCode: 1 } as any);
      const status = await adapter.getRuntimeStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('ensureRuntime', () => {
    it('does nothing when Docker is running', async () => {
      mockedExeca.mockResolvedValue({ exitCode: 0 } as any);
      await expect(adapter.ensureRuntime({} as any)).resolves.toBeUndefined();
    });

    it('throws when Docker is not running', async () => {
      mockedExeca.mockResolvedValue({ exitCode: 1 } as any);
      await expect(adapter.ensureRuntime({} as any)).rejects.toThrow('Docker is not running');
    });
  });

  describe('needsVM', () => {
    it('returns false', () => {
      expect(adapter.needsVM).toBe(false);
    });
  });

  describe('prerequisites', () => {
    it('includes docker and jq (no colima)', () => {
      expect(adapter.prerequisites).toEqual(['docker', 'jq']);
      expect(adapter.prerequisites).not.toContain('colima');
    });
  });

  describe('checkPackageManager', () => {
    it('always returns available: true', async () => {
      const result = await adapter.checkPackageManager();
      expect(result.available).toBe(true);
    });
  });

  describe('stopRuntime', () => {
    it('is a no-op (does not throw)', async () => {
      await expect(adapter.stopRuntime()).resolves.toBeUndefined();
    });
  });
});
