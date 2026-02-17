import { vi } from 'vitest';
vi.mock('node:fs');
import * as fs from 'node:fs';

import * as os from 'node:os';
import {
  getJobsFilePath,
  getLogsDir,
  getJobLogsDir,
  getSchedulerLogPath,
  getLaunchdPlistPath,
  getDefaultConfig,
  loadConfig,
  saveConfig,
  updateConfig,
} from '../config.js';
import { makeConfig } from './fixtures.js';

// ─── getJobsFilePath ────────────────────────────────────────

describe('getJobsFilePath', () => {
  it('returns <projectDir>/jobs.json', () => {
    const config = makeConfig({ projectDir: '/tmp/test' });
    expect(getJobsFilePath(config)).toBe('/tmp/test/jobs.json');
  });

  it('works with a home-relative project dir', () => {
    const config = makeConfig({ projectDir: '/home/user/project' });
    expect(getJobsFilePath(config)).toBe('/home/user/project/jobs.json');
  });

  it('works with a path containing spaces', () => {
    const config = makeConfig({ projectDir: '/tmp/my project' });
    expect(getJobsFilePath(config)).toBe('/tmp/my project/jobs.json');
  });
});

// ─── getLogsDir ─────────────────────────────────────────────

describe('getLogsDir', () => {
  it('returns <projectDir>/logs', () => {
    const config = makeConfig({ projectDir: '/tmp/test' });
    expect(getLogsDir(config)).toBe('/tmp/test/logs');
  });
});

// ─── getJobLogsDir ──────────────────────────────────────────

describe('getJobLogsDir', () => {
  it('returns <projectDir>/logs/jobs/<jobId>', () => {
    const config = makeConfig({ projectDir: '/tmp/test' });
    expect(getJobLogsDir(config, 'my-job')).toBe('/tmp/test/logs/jobs/my-job');
  });

  it('works with hyphenated job ID', () => {
    const config = makeConfig();
    expect(getJobLogsDir(config, 'daily-backup')).toBe(
      '/tmp/test-project/logs/jobs/daily-backup',
    );
  });

  it('works with underscore job ID', () => {
    const config = makeConfig();
    expect(getJobLogsDir(config, 'data_sync')).toBe(
      '/tmp/test-project/logs/jobs/data_sync',
    );
  });
});

// ─── getSchedulerLogPath ────────────────────────────────────

describe('getSchedulerLogPath', () => {
  it('returns <projectDir>/logs/scheduler.log', () => {
    const config = makeConfig({ projectDir: '/tmp/test' });
    expect(getSchedulerLogPath(config)).toBe('/tmp/test/logs/scheduler.log');
  });
});

// ─── getLaunchdPlistPath ────────────────────────────────────

describe('getLaunchdPlistPath', () => {
  it('returns ~/Library/LaunchAgents/com.agent-oven.scheduler.plist', () => {
    const expected = `${os.homedir()}/Library/LaunchAgents/com.agent-oven.scheduler.plist`;
    expect(getLaunchdPlistPath()).toBe(expected);
  });
});

// ─── getDefaultConfig ───────────────────────────────────────

describe('getDefaultConfig', () => {
  it('returns correct colima defaults', () => {
    const defaults = getDefaultConfig();
    expect(defaults.colima).toEqual({ cpu: 2, memory: 4, disk: 20 });
  });

  it('returns correct docker defaults', () => {
    const defaults = getDefaultConfig();
    expect(defaults.docker).toEqual({ defaultCpus: 1, defaultMemory: '512m' });
  });

  it('returns a non-empty IANA timezone string', () => {
    const defaults = getDefaultConfig();
    expect(defaults.timezone).toBeTruthy();
    expect(defaults.timezone).toContain('/');
  });

  it('includes auth defaults', () => {
    const defaults = getDefaultConfig();
    expect(defaults.auth).toBeDefined();
    expect(defaults.auth!.defaultMode).toBe('host-login');
  });

  it('does NOT include projectDir', () => {
    const defaults = getDefaultConfig();
    expect('projectDir' in defaults).toBe(false);
  });
});

// ─── loadConfig ─────────────────────────────────────────────

describe('loadConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const CONFIG_PATH = '/tmp/test-xdg/agent-oven/config.json';
  const CONFIG_DIR = '/tmp/test-xdg/agent-oven';

  beforeEach(() => {
    vi.resetAllMocks();
    savedEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = '/tmp/test-xdg';
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/fake-cwd');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = savedEnv;
    cwdSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('returns defaults with cwd fallback when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadConfig();

    expect(config.projectDir).toBe('/tmp/fake-cwd');
    expect(config.colima).toEqual({ cpu: 2, memory: 4, disk: 20 });
    expect(config.docker).toEqual({ defaultCpus: 1, defaultMemory: '512m' });
  });

  it('loads and merges a valid config file', () => {
    const savedConfig = {
      projectDir: '/home/user/agent-oven',
      colima: { cpu: 8 },
    };
    const existsMap: Record<string, boolean> = {
      [CONFIG_PATH]: true,
      '/home/user/agent-oven': true,
    };
    vi.mocked(fs.existsSync).mockImplementation((p) => existsMap[String(p)] ?? false);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(savedConfig));

    const config = loadConfig();

    expect(config.projectDir).toBe('/home/user/agent-oven');
    expect(config.colima.cpu).toBe(8);
    // Defaults are preserved for fields not in saved config
    expect(config.colima.memory).toBe(4);
    expect(config.colima.disk).toBe(20);
  });

  it('falls back to cwd on corrupt JSON and logs a warning', () => {
    const existsMap: Record<string, boolean> = {
      [CONFIG_PATH]: true,
    };
    vi.mocked(fs.existsSync).mockImplementation((p) => existsMap[String(p)] ?? false);
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json {');

    const config = loadConfig();

    expect(config.projectDir).toBe('/tmp/fake-cwd');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning'),
      expect.anything(),
    );
  });

  it('falls back to cwd when saved projectDir no longer exists', () => {
    const savedConfig = { projectDir: '/gone/project' };
    const existsMap: Record<string, boolean> = {
      [CONFIG_PATH]: true,
      '/gone/project': false,
    };
    vi.mocked(fs.existsSync).mockImplementation((p) => existsMap[String(p)] ?? false);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(savedConfig));

    const config = loadConfig();

    expect(config.projectDir).toBe('/tmp/fake-cwd');
  });
});

// ─── saveConfig ─────────────────────────────────────────────

describe('saveConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;

  const CONFIG_DIR = '/tmp/test-xdg/agent-oven';
  const CONFIG_PATH = '/tmp/test-xdg/agent-oven/config.json';

  beforeEach(() => {
    vi.resetAllMocks();
    savedEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = '/tmp/test-xdg';
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('creates config dir when missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    saveConfig(makeConfig());

    expect(fs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.stringContaining('"projectDir"'),
    );
  });

  it('skips mkdir when dir already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    saveConfig(makeConfig());

    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.stringContaining('"projectDir"'),
    );
  });
});

// ─── updateConfig ───────────────────────────────────────────

describe('updateConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  const CONFIG_PATH = '/tmp/test-xdg/agent-oven/config.json';

  beforeEach(() => {
    vi.resetAllMocks();
    savedEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = '/tmp/test-xdg';
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/fake-cwd');
  });

  afterEach(() => {
    process.env = savedEnv;
    cwdSpy.mockRestore();
  });

  it('deep-merges colima updates', () => {
    const baseline = {
      projectDir: '/home/user/ao',
      colima: { cpu: 4, memory: 4, disk: 20 },
      docker: { defaultCpus: 1, defaultMemory: '512m' },
      timezone: 'UTC',
    };
    const existsMap: Record<string, boolean> = {
      [CONFIG_PATH]: true,
      '/home/user/ao': true,
    };
    vi.mocked(fs.existsSync).mockImplementation((p) => existsMap[String(p)] ?? false);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(baseline));

    const result = updateConfig({ colima: { cpu: 16, memory: 4, disk: 20 } });

    expect(result.colima.cpu).toBe(16);
    expect(result.colima.memory).toBe(4);
    expect(result.projectDir).toBe('/home/user/ao');

    // Verify writeFileSync was called with the merged config
    const written = JSON.parse(
      (vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string).trim(),
    );
    expect(written.colima.cpu).toBe(16);
  });

  it('deep-merges auth updates', () => {
    const baseline = {
      projectDir: '/home/user/ao',
      colima: { cpu: 2, memory: 4, disk: 20 },
      docker: { defaultCpus: 1, defaultMemory: '512m' },
      timezone: 'UTC',
      auth: {
        defaultMode: 'api-key',
        claudeCredPath: '/custom/.claude',
        ghCredPath: '/custom/.config/gh',
      },
    };
    const existsMap: Record<string, boolean> = {
      [CONFIG_PATH]: true,
      '/home/user/ao': true,
    };
    vi.mocked(fs.existsSync).mockImplementation((p) => existsMap[String(p)] ?? false);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(baseline));

    const result = updateConfig({
      auth: {
        defaultMode: 'host-login',
        claudeCredPath: '/custom/.claude',
        ghCredPath: '/custom/.config/gh',
      },
    });

    expect(result.auth!.defaultMode).toBe('host-login');
    expect(result.auth!.claudeCredPath).toBe('/custom/.claude');
  });
});
