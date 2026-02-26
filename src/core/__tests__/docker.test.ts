import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  openSync: vi.fn(() => 42),
  closeSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}));

import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { runJob } from '../docker.js';
import { makeConfig, makeDockerJob, makePipelineJob } from './fixtures.js';

class FakeChild extends EventEmitter {
  unref = vi.fn();
}

const spawnMock = vi.mocked(spawn);

describe('runJob (detached)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.openSync).mockReturnValue(42);
    vi.mocked(fs.readFileSync).mockReturnValue('');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns failure when detached spawn emits an error', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const config = makeConfig();
    const job = makeDockerJob();

    const resultPromise = runJob(config, job, { detach: true });
    child.emit('error', new Error('spawn ENOENT'));
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Failed to start detached job');
    expect(child.unref).not.toHaveBeenCalled();
    expect(fs.closeSync).toHaveBeenCalledWith(42);
  });

  it('returns failure when detached process exits non-zero before startup grace period', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);
    vi.mocked(fs.readFileSync).mockReturnValue('docker: pull access denied');

    const config = makeConfig();
    const job = makeDockerJob();

    const resultPromise = runJob(config, job, { detach: true });
    child.emit('exit', 125, null);
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(125);
    expect(result.output).toContain('pull access denied');
    expect(child.unref).not.toHaveBeenCalled();
  });

  it('returns success and unrefs child when detached process keeps running past startup grace period', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const config = makeConfig();
    const job = makeDockerJob();

    const resultPromise = runJob(config, job, { detach: true });
    await vi.advanceTimersByTimeAsync(750);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Job started in background');
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('applies detached startup failure handling for pipeline jobs too', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);
    vi.mocked(fs.readFileSync).mockReturnValue('pipeline runner failed');

    const config = makeConfig();
    const job = makePipelineJob({
      auth: 'api-key',
      env: {
        ANTHROPIC_API_KEY: 'test-key',
        GH_TOKEN: 'test-token',
      },
    });

    const resultPromise = runJob(config, job, { detach: true });
    child.emit('exit', 2, null);
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('pipeline runner failed');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
