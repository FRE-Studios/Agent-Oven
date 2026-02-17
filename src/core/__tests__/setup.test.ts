import { vi } from 'vitest';

vi.mock('../config.js', () => ({
  saveConfig: vi.fn(),
  getLaunchdPlistPath: vi.fn(() => '/tmp/test.plist'),
}));

import { detectTimezone, buildConfig } from '../setup.js';

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
