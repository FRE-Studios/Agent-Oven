import { vi } from 'vitest';
vi.mock('node:fs');
import * as fs from 'node:fs';

import {
  resolveAuthMode,
  generateAuthArgs,
  checkAuthHealth,
  validateAuthForJob,
} from '../auth.js';
import { makePipelineJob, makeAuthConfig } from './fixtures.js';

// ─── resolveAuthMode ────────────────────────────────────────

describe('resolveAuthMode', () => {
  it('returns host-login when job.auth is host-login', () => {
    const job = makePipelineJob({ auth: 'host-login' });
    const config = makeAuthConfig({ defaultMode: 'api-key' });
    expect(resolveAuthMode(job, config)).toBe('host-login');
  });

  it('returns api-key when job.auth is api-key', () => {
    const job = makePipelineJob({ auth: 'api-key' });
    const config = makeAuthConfig({ defaultMode: 'host-login' });
    expect(resolveAuthMode(job, config)).toBe('api-key');
  });

  it('falls back to config defaultMode when job.auth is undefined', () => {
    const job = makePipelineJob({ auth: undefined });
    const config = makeAuthConfig({ defaultMode: 'host-login' });
    expect(resolveAuthMode(job, config)).toBe('host-login');
  });

  it('falls back to api-key config default when job.auth is undefined', () => {
    const job = makePipelineJob({ auth: undefined });
    const config = makeAuthConfig({ defaultMode: 'api-key' });
    expect(resolveAuthMode(job, config)).toBe('api-key');
  });

  it('job-level host-login overrides api-key config default', () => {
    const job = makePipelineJob({ auth: 'host-login' });
    const config = makeAuthConfig({ defaultMode: 'api-key' });
    expect(resolveAuthMode(job, config)).toBe('host-login');
  });

  it('job-level api-key overrides host-login config default', () => {
    const job = makePipelineJob({ auth: 'api-key' });
    const config = makeAuthConfig({ defaultMode: 'host-login' });
    expect(resolveAuthMode(job, config)).toBe('api-key');
  });

  it('works with a job that has no auth field set at all', () => {
    const job = makePipelineJob();
    // makePipelineJob does not set auth, so it's undefined
    const config = makeAuthConfig({ defaultMode: 'host-login' });
    expect(resolveAuthMode(job, config)).toBe('host-login');
  });

  it('returns the correct mode when both job and config agree', () => {
    const job = makePipelineJob({ auth: 'api-key' });
    const config = makeAuthConfig({ defaultMode: 'api-key' });
    expect(resolveAuthMode(job, config)).toBe('api-key');
  });
});

// ─── generateAuthArgs ───────────────────────────────────────

describe('generateAuthArgs', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    savedEnv = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('host-login: mounts both dirs and .claude.json when all exist', () => {
    const config = makeAuthConfig({
      claudeCredPath: '/home/user/.claude',
      ghCredPath: '/home/user/.config/gh',
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/home/user/.claude' || p === '/home/user/.claude.json' || p === '/home/user/.config/gh',
    );

    const result = generateAuthArgs('host-login', config);

    expect(result.volumes).toEqual([
      '/home/user/.claude:/root/.claude:ro',
      '/home/user/.claude.json:/root/.claude.json:ro',
      '/home/user/.config/gh:/root/.config/gh:ro',
    ]);
    expect(result.envVars).toEqual({});
  });

  it('host-login: mounts claude dir without .claude.json when json file missing', () => {
    const config = makeAuthConfig({
      claudeCredPath: '/home/user/.claude',
      ghCredPath: '/home/user/.config/gh',
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/home/user/.claude' || p === '/home/user/.config/gh',
    );

    const result = generateAuthArgs('host-login', config);

    expect(result.volumes).toEqual([
      '/home/user/.claude:/root/.claude:ro',
      '/home/user/.config/gh:/root/.config/gh:ro',
    ]);
  });

  it('host-login: mounts only claude when gh path missing', () => {
    const config = makeAuthConfig({
      claudeCredPath: '/home/user/.claude',
      ghCredPath: '/home/user/.config/gh',
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => p === '/home/user/.claude');

    const result = generateAuthArgs('host-login', config);

    expect(result.volumes).toEqual(['/home/user/.claude:/root/.claude:ro']);
    expect(result.envVars).toEqual({});
  });

  it('host-login: empty volumes when neither path exists', () => {
    const config = makeAuthConfig();
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = generateAuthArgs('host-login', config);

    expect(result.volumes).toEqual([]);
    expect(result.envVars).toEqual({});
  });

  it('api-key: passes keys from jobEnv', () => {
    const config = makeAuthConfig();
    const jobEnv = { ANTHROPIC_API_KEY: 'sk-ant-123', GH_TOKEN: 'ghp_abc' };

    const result = generateAuthArgs('api-key', config, jobEnv);

    expect(result.envVars).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-123',
      GH_TOKEN: 'ghp_abc',
    });
    expect(result.volumes).toEqual([]);
  });

  it('api-key: falls back to process.env when jobEnv has no keys', () => {
    const config = makeAuthConfig();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    process.env.GH_TOKEN = 'ghp_env';

    const result = generateAuthArgs('api-key', config, {});

    expect(result.envVars).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-env',
      GH_TOKEN: 'ghp_env',
    });
  });

  it('api-key: empty envVars when no keys anywhere', () => {
    const config = makeAuthConfig();

    const result = generateAuthArgs('api-key', config, {});

    expect(result.envVars).toEqual({});
    expect(result.volumes).toEqual([]);
  });
});

// ─── checkAuthHealth ────────────────────────────────────────

describe('checkAuthHealth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reports both healthy when paths are valid non-empty dirs and .claude.json exists', () => {
    const config = makeAuthConfig({
      claudeCredPath: '/home/.claude',
      ghCredPath: '/home/.config/gh',
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(fs.readdirSync).mockReturnValue(['credentials.json'] as any);

    const health = checkAuthHealth(config);

    expect(health.claude.available).toBe(true);
    expect(health.claude.error).toBeUndefined();
    expect(health.claude.warning).toBeUndefined();
    expect(health.github.available).toBe(true);
    expect(health.github.error).toBeUndefined();
  });

  it('warns when claude dir is healthy but .claude.json is missing', () => {
    const config = makeAuthConfig({
      claudeCredPath: '/home/.claude',
      ghCredPath: '/home/.config/gh',
    });

    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p !== '/home/.claude.json',
    );
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(fs.readdirSync).mockReturnValue(['credentials.json'] as any);

    const health = checkAuthHealth(config);

    expect(health.claude.available).toBe(true);
    expect(health.claude.warning).toContain('.claude.json');
  });

  it('reports not found when paths do not exist', () => {
    const config = makeAuthConfig();
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const health = checkAuthHealth(config);

    expect(health.claude.available).toBe(false);
    expect(health.claude.error).toContain('not found');
    expect(health.github.available).toBe(false);
    expect(health.github.error).toContain('not found');
  });

  it('reports error when path is a file not a directory', () => {
    const config = makeAuthConfig();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);

    const health = checkAuthHealth(config);

    expect(health.claude.available).toBe(false);
    expect(health.claude.error).toContain('not a directory');
    expect(health.github.available).toBe(false);
    expect(health.github.error).toContain('not a directory');
  });

  it('reports error when directory is empty', () => {
    const config = makeAuthConfig();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const health = checkAuthHealth(config);

    expect(health.claude.available).toBe(false);
    expect(health.claude.error).toContain('empty');
    expect(health.github.available).toBe(false);
    expect(health.github.error).toContain('empty');
  });
});

// ─── validateAuthForJob ─────────────────────────────────────

describe('validateAuthForJob', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    savedEnv = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('host-login: does not throw when credentials are healthy', () => {
    const job = makePipelineJob({ auth: 'host-login' });
    const config = makeAuthConfig();

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(fs.readdirSync).mockReturnValue(['file'] as any);

    expect(() => validateAuthForJob(job, config)).not.toThrow();
    expect(validateAuthForJob(job, config)).toEqual([]);
  });

  it('host-login: returns warning when .claude.json is missing', () => {
    const job = makePipelineJob({ auth: 'host-login' });
    const config = makeAuthConfig({ claudeCredPath: '/home/.claude' });

    vi.mocked(fs.existsSync).mockImplementation((p) => p !== '/home/.claude.json');
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(fs.readdirSync).mockReturnValue(['file'] as any);

    const warnings = validateAuthForJob(job, config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.claude.json');
  });

  it('host-login: throws when credential paths missing', () => {
    const job = makePipelineJob({ auth: 'host-login' });
    const config = makeAuthConfig();

    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => validateAuthForJob(job, config)).toThrow(/Auth validation failed/);
    try {
      validateAuthForJob(job, config);
    } catch (e: any) {
      expect(e.message).toContain('Claude');
      expect(e.message).toContain('GitHub');
    }
  });

  it('api-key: does not throw when keys are in job env', () => {
    const job = makePipelineJob({
      auth: 'api-key',
      env: { ANTHROPIC_API_KEY: 'sk-ant-123', GH_TOKEN: 'ghp_abc' },
    });
    const config = makeAuthConfig();

    expect(() => validateAuthForJob(job, config)).not.toThrow();
  });

  it('api-key: throws when no keys in job env or process env', () => {
    const job = makePipelineJob({ auth: 'api-key' });
    const config = makeAuthConfig();

    expect(() => validateAuthForJob(job, config)).toThrow(/Auth validation failed/);
    try {
      validateAuthForJob(job, config);
    } catch (e: any) {
      expect(e.message).toContain('ANTHROPIC_API_KEY');
    }
  });
});
