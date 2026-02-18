import { vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../config.js', () => ({
  saveConfig: vi.fn(),
}));

import {
  detectTimezone,
  buildConfig,
  resolveSchedulerCommand,
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
