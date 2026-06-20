import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(async () => ({ stdout: 'false' })),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => true, mtimeMs: Date.now() })),
  unlinkSync: vi.fn(),
}));

vi.mock('../jobs.js', () => ({
  listJobs: vi.fn(() => []),
  updateLastRun: vi.fn(),
  removeJob: vi.fn(),
}));

vi.mock('../docker.js', () => ({
  runJob: vi.fn(async () => ({ success: true, exitCode: 0, logFile: '/tmp/x.log' })),
}));

vi.mock('../scheduler.js', () => ({
  shouldRunNow: vi.fn(() => true),
}));

vi.mock('../host-lock.js', () => ({
  isHostJobRunning: vi.fn(() => false),
}));

vi.mock('../platform.js', () => ({
  platform: {
    needsVM: false,
    getRuntimeStatus: vi.fn(async () => ({ running: true })),
    ensureRuntime: vi.fn(async () => {}),
  },
}));

import { listJobs } from '../jobs.js';
import { runJob } from '../docker.js';
import { shouldRunNow } from '../scheduler.js';
import { isHostJobRunning } from '../host-lock.js';
import { platform } from '../platform.js';
import { runSchedulerTick } from '../scheduler-runner.js';
import { makeConfig, makeDockerJob, makeHostJob } from './fixtures.js';

const config = makeConfig();

describe('runSchedulerTick — runtime gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldRunNow).mockReturnValue(true);
    vi.mocked(isHostJobRunning).mockReturnValue(false);
  });

  it('does not start the container runtime when only host jobs are due', async () => {
    vi.mocked(listJobs).mockReturnValue([makeHostJob({ id: 'h1' })]);

    const code = await runSchedulerTick(config);

    expect(code).toBe(0);
    expect(platform.getRuntimeStatus).not.toHaveBeenCalled();
    expect(platform.ensureRuntime).not.toHaveBeenCalled();
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it('starts the container runtime when a docker job is due', async () => {
    vi.mocked(listJobs).mockReturnValue([makeDockerJob({ id: 'd1' })]);

    await runSchedulerTick(config);

    expect(platform.getRuntimeStatus).toHaveBeenCalled();
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it('starts the container runtime when host and docker jobs are both due', async () => {
    vi.mocked(listJobs).mockReturnValue([
      makeHostJob({ id: 'h1' }),
      makeDockerJob({ id: 'd1' }),
    ]);

    await runSchedulerTick(config);

    expect(platform.getRuntimeStatus).toHaveBeenCalled();
    expect(runJob).toHaveBeenCalledTimes(2);
  });
});

describe('runSchedulerTick — host overlap skip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldRunNow).mockReturnValue(true);
  });

  it('skips a host job whose previous run is still active', async () => {
    vi.mocked(listJobs).mockReturnValue([makeHostJob({ id: 'h1' })]);
    vi.mocked(isHostJobRunning).mockReturnValue(true);

    const code = await runSchedulerTick(config);

    expect(code).toBe(0);
    expect(isHostJobRunning).toHaveBeenCalledWith(config, 'h1');
    expect(runJob).not.toHaveBeenCalled();
  });

  it('runs a host job when no previous run is active', async () => {
    vi.mocked(listJobs).mockReturnValue([makeHostJob({ id: 'h1' })]);
    vi.mocked(isHostJobRunning).mockReturnValue(false);

    await runSchedulerTick(config);

    expect(runJob).toHaveBeenCalledTimes(1);
  });
});
