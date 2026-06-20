import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
}));

import * as fs from 'node:fs';
import {
  getPidFilePath,
  writePidFile,
  removePidFile,
  isHostJobRunning,
} from '../host-lock.js';
import { makeConfig } from './fixtures.js';

const config = makeConfig({ projectDir: '/proj' });

describe('getPidFilePath', () => {
  it('lives under logs/run', () => {
    expect(getPidFilePath(config, 'my-job')).toBe('/proj/logs/run/my-job.pid');
  });
});

describe('writePidFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the run dir and writes the pid', () => {
    writePidFile(config, 'my-job', 1234);
    expect(fs.mkdirSync).toHaveBeenCalledWith('/proj/logs/run', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith('/proj/logs/run/my-job.pid', '1234');
  });

  it('is a no-op when pid is undefined', () => {
    writePidFile(config, 'my-job', undefined);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('removePidFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unlinks the lockfile', () => {
    removePidFile(config, 'my-job');
    expect(fs.unlinkSync).toHaveBeenCalledWith('/proj/logs/run/my-job.pid');
  });

  it('swallows errors when the file is already gone', () => {
    vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => removePidFile(config, 'my-job')).not.toThrow();
  });
});

describe('isHostJobRunning', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('returns false when there is no lockfile', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(isHostJobRunning(config, 'my-job')).toBe(false);
  });

  it('returns true when the recorded PID is alive', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('4321');
    killSpy.mockReturnValue(true); // signal 0 succeeds → alive
    expect(isHostJobRunning(config, 'my-job')).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(4321, 0);
  });

  it('treats EPERM as alive (process owned by another user)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('4321');
    killSpy.mockImplementation(() => { const e: any = new Error('EPERM'); e.code = 'EPERM'; throw e; });
    expect(isHostJobRunning(config, 'my-job')).toBe(true);
  });

  it('reaps a stale lockfile whose PID is dead', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('4321');
    killSpy.mockImplementation(() => { const e: any = new Error('ESRCH'); e.code = 'ESRCH'; throw e; });
    expect(isHostJobRunning(config, 'my-job')).toBe(false);
    expect(fs.unlinkSync).toHaveBeenCalledWith('/proj/logs/run/my-job.pid');
  });
});
