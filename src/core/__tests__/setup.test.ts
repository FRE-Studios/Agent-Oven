import { vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

vi.mock('../config.js', () => ({
  saveConfig: vi.fn(),
}));

import {
  detectTimezone,
  buildConfig,
  resolveSchedulerCommand,
  resolveStableNodePath,
} from '../setup.js';

// ─── detectTimezone ─────────────────────────────────────────

describe('detectTimezone', () => {
  it('returns a non-empty string', () => {
    const tz = detectTimezone();
    expect(tz).toBeTruthy();
    expect(typeof tz).toBe('string');
  });

  it('matches Intl.DateTimeFormat result', () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(detectTimezone()).toBe(expected);
  });

  it('returns a string containing a slash (IANA format)', () => {
    expect(detectTimezone()).toContain('/');
  });
});

// ─── buildConfig ────────────────────────────────────────────

describe('buildConfig', () => {
  it('returns a Config with the provided projectDir', () => {
    const config = buildConfig({
      projectDir: '/opt/my-project',
      cpu: 4,
      memory: 8,
      disk: 40,
      timezone: 'Europe/Berlin',
    });
    expect(config.projectDir).toBe('/opt/my-project');
  });

  it('sets colima values from input', () => {
    const config = buildConfig({
      projectDir: '/tmp/test',
      cpu: 4,
      memory: 8,
      disk: 40,
      timezone: 'UTC',
    });
    expect(config.colima).toEqual({ cpu: 4, memory: 8, disk: 40 });
  });

  it('sets timezone from input', () => {
    const config = buildConfig({
      projectDir: '/tmp/test',
      cpu: 2,
      memory: 4,
      disk: 20,
      timezone: 'Asia/Tokyo',
    });
    expect(config.timezone).toBe('Asia/Tokyo');
  });

  it('sets docker defaults', () => {
    const config = buildConfig({
      projectDir: '/tmp/test',
      cpu: 2,
      memory: 4,
      disk: 20,
      timezone: 'UTC',
    });
    expect(config.docker).toEqual({ defaultCpus: 1, defaultMemory: '512m' });
  });

  it('sets auth with host-login default', () => {
    const config = buildConfig({
      projectDir: '/tmp/test',
      cpu: 2,
      memory: 4,
      disk: 20,
      timezone: 'UTC',
    });
    expect(config.auth).toBeDefined();
    expect(config.auth!.defaultMode).toBe('host-login');
  });
});

// ─── resolveStableNodePath ───────────────────────────────────

describe('resolveStableNodePath', () => {
  const originalExecPath = process.execPath;
  const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;

  afterEach(() => {
    Object.defineProperty(process, 'execPath', { value: originalExecPath, writable: true });
    existsSyncMock.mockRestore();
  });

  it('returns process.execPath when not in a Cellar path', () => {
    Object.defineProperty(process, 'execPath', { value: '/usr/local/bin/node', writable: true });
    expect(resolveStableNodePath()).toBe('/usr/local/bin/node');
  });

  it('returns stable /opt/homebrew/bin/node when execPath is a Cellar path and symlink exists', () => {
    Object.defineProperty(process, 'execPath', {
      value: '/opt/homebrew/Cellar/node/25.6.0/bin/node',
      writable: true,
    });
    existsSyncMock.mockImplementation((p: string) => String(p) === '/opt/homebrew/bin/node');

    expect(resolveStableNodePath()).toBe('/opt/homebrew/bin/node');
  });

  it('returns stable /usr/local/bin/node for Intel Homebrew Cellar paths', () => {
    Object.defineProperty(process, 'execPath', {
      value: '/usr/local/Cellar/node/22.0.0/bin/node',
      writable: true,
    });
    existsSyncMock.mockImplementation((p: string) => String(p) === '/usr/local/bin/node');

    expect(resolveStableNodePath()).toBe('/usr/local/bin/node');
  });

  it('falls back to Cellar path when stable symlink does not exist', () => {
    const cellarPath = '/opt/homebrew/Cellar/node/25.6.0/bin/node';
    Object.defineProperty(process, 'execPath', { value: cellarPath, writable: true });
    existsSyncMock.mockReturnValue(false);

    expect(resolveStableNodePath()).toBe(cellarPath);
  });
});

// ─── resolveSchedulerCommand ──────────────────────────────────

describe('resolveSchedulerCommand', () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
  });

  it('returns legacy scheduler.sh when fallback is enabled', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-oven-'));
    const schedulerPath = path.join(projectDir, 'scheduler.sh');
    fs.writeFileSync(schedulerPath, '#!/bin/sh\n');
    process.argv = [process.execPath, ''];

    await expect(resolveSchedulerCommand(projectDir)).resolves.toEqual([schedulerPath]);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('throws when only scheduler.sh exists and legacy fallback is disabled', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-oven-'));
    fs.writeFileSync(path.join(projectDir, 'scheduler.sh'), '#!/bin/sh\n');
    process.argv = [process.execPath, ''];

    await expect(
      resolveSchedulerCommand(projectDir, { allowLegacyFallback: false }),
    ).rejects.toThrow('Build the project first');
    fs.rmSync(projectDir, { recursive: true, force: true });
  });
});
