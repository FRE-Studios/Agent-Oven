import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

// Keep prepareLogFile/shellEscape real-ish; stub the detached spawn so we can
// assert how the host runner wires it up.
vi.mock('../run-utils.js', () => ({
  prepareLogFile: vi.fn(() => '/tmp/jobs/test-host/ts.log'),
  shellEscape: (s: string) => "'" + s.replace(/'/g, "'\\''") + "'",
  spawnDetachedRun: vi.fn(async () => ({ success: true, exitCode: 0, logFile: '/tmp/jobs/test-host/ts.log' })),
}));

vi.mock('../host-lock.js', () => ({
  getPidFilePath: vi.fn(() => '/tmp/run/test-host.pid'),
  writePidFile: vi.fn(),
  removePidFile: vi.fn(),
}));

import { execa } from 'execa';
import * as fs from 'node:fs';
import { spawnDetachedRun } from '../run-utils.js';
import { writePidFile, removePidFile } from '../host-lock.js';
import { runHostJob } from '../host-runner.js';
import { makeConfig, makeHostJob } from './fixtures.js';

const execaMock = vi.mocked(execa);

/** A fake execa subprocess: an awaitable that also carries a `.pid`. */
function fakeSubprocess(result: { stdout?: string; stderr?: string; exitCode: number }, pid = 4321) {
  const p = Promise.resolve(result) as Promise<typeof result> & { pid: number };
  p.pid = pid;
  return p;
}

describe('runHostJob (foreground)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('execs an array command argv-style with cwd, merged env, and timeout', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: 'hi', stderr: '', exitCode: 0 }) as any);

    const config = makeConfig({ projectDir: '/proj' });
    const job = makeHostJob({
      command: ['mybin', '--flag'],
      cwd: 'sub/dir',
      env: { FOO: 'bar' },
      resources: { timeout: 30 },
    });

    const result = await runHostJob(config, job);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);

    const [file, args, opts] = execaMock.mock.calls[0]!;
    expect(file).toBe('mybin');
    expect(args).toEqual(['--flag']);
    // Relative cwd resolves against projectDir
    expect((opts as any).cwd).toBe('/proj/sub/dir');
    // timeout in ms
    expect((opts as any).timeout).toBe(30_000);
    // PATH augmented + job env override applied
    expect((opts as any).env.PATH).toContain('/opt/homebrew/bin');
    expect((opts as any).env.FOO).toBe('bar');
    // not shell mode for array command
    expect((opts as any).shell).toBeUndefined();
  });

  it('defaults cwd to projectDir when not set', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: '', stderr: '', exitCode: 0 }) as any);
    const config = makeConfig({ projectDir: '/proj' });

    await runHostJob(config, makeHostJob({ cwd: undefined }));

    expect((execaMock.mock.calls[0]![2] as any).cwd).toBe('/proj');
  });

  it('runs a string command through the shell', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: '', stderr: '', exitCode: 0 }) as any);

    await runHostJob(makeConfig(), makeHostJob({ command: 'echo hi | tee out.txt' }));

    const [cmd, opts] = execaMock.mock.calls[0]!;
    expect(cmd).toBe('echo hi | tee out.txt');
    expect((opts as any).shell).toBe(true);
  });

  it('runs an array command through the shell when shell:true', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: '', stderr: '', exitCode: 0 }) as any);

    await runHostJob(makeConfig(), makeHostJob({ command: ['echo', 'hi'], shell: true }));

    const [cmd, opts] = execaMock.mock.calls[0]!;
    expect(cmd).toBe('echo hi');
    expect((opts as any).shell).toBe(true);
  });

  it('writes the log header and footer with host type and exit code', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: 'output', stderr: '', exitCode: 0 }) as any);

    await runHostJob(makeConfig({ projectDir: '/proj' }), makeHostJob({ command: ['echo', 'hello'] }));

    const header = String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]);
    expect(header).toContain('=== Type: host ===');
    expect(header).toContain('=== Command: echo hello ===');
    expect(header).toContain('=== Cwd: /proj ===');

    const footer = String(vi.mocked(fs.appendFileSync).mock.calls[0]![1]);
    expect(footer).toContain('=== Exit Code: 0 ===');
  });

  it('maps a non-zero exit code to failure', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: '', stderr: 'boom', exitCode: 3 }) as any);

    const result = await runHostJob(makeConfig(), makeHostJob());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('records the running PID and clears it on completion', async () => {
    execaMock.mockReturnValue(fakeSubprocess({ stdout: '', stderr: '', exitCode: 0 }, 5555) as any);

    await runHostJob(makeConfig(), makeHostJob({ id: 'test-host' }));

    expect(writePidFile).toHaveBeenCalledWith(expect.anything(), 'test-host', 5555);
    expect(removePidFile).toHaveBeenCalledWith(expect.anything(), 'test-host');
  });

  it('clears the PID lockfile even when the command throws', async () => {
    const err: any = new Error('spawn failed');
    err.exitCode = 1;
    execaMock.mockReturnValue(Object.assign(Promise.reject(err), { pid: 7 }) as any);

    const result = await runHostJob(makeConfig(), makeHostJob({ id: 'test-host' }));

    expect(result.success).toBe(false);
    expect(removePidFile).toHaveBeenCalledWith(expect.anything(), 'test-host');
  });
});

describe('runHostJob (detached)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to spawnDetachedRun with cwd, env, lockfile cleanup, and PID hook', async () => {
    const config = makeConfig({ projectDir: '/proj' });
    const job = makeHostJob({ id: 'test-host', command: ['mybin', 'arg one'], env: { FOO: 'bar' } });

    const result = await runHostJob(config, job, { detach: true });

    expect(result.success).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();

    const [commandLine, logFile, opts] = vi.mocked(spawnDetachedRun).mock.calls[0]!;
    // array argv is shell-escaped into a command line
    expect(commandLine).toBe("'mybin' 'arg one'");
    expect(logFile).toBe('/tmp/jobs/test-host/ts.log');
    expect((opts as any).cwd).toBe('/proj');
    expect((opts as any).env.FOO).toBe('bar');
    expect((opts as any).cleanupCommand).toContain('/tmp/run/test-host.pid');

    // The onSpawn hook records the live PID
    (opts as any).onSpawn(9999);
    expect(writePidFile).toHaveBeenCalledWith(config, 'test-host', 9999);
  });
});
