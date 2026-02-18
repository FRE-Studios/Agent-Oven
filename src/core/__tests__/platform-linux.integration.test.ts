import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LinuxAdapter } from '../platform-linux.js';

describe('LinuxAdapter generateDaemonConfig integration', () => {
  const originalArgv = process.argv.slice();
  const tempDirs: string[] = [];

  afterEach(() => {
    process.argv = originalArgv.slice();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses dist/cli.js and properly quotes paths with spaces', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent oven-'));
    tempDirs.push(projectDir);
    fs.mkdirSync(path.join(projectDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'dist', 'cli.js'), 'console.log("ok");\n');
    fs.writeFileSync(path.join(projectDir, 'scheduler.sh'), '#!/bin/sh\necho legacy\n');

    // Prevent resolveSchedulerCommand() from picking the current vitest entrypoint.
    process.argv = [process.execPath, ''];

    const adapter = new LinuxAdapter();
    const content = await adapter.generateDaemonConfig(projectDir);

    expect(content).toContain(`"${path.join(projectDir, 'dist', 'cli.js')}"`);
    expect(content).toContain('scheduler-tick');
    expect(content).not.toContain('scheduler.sh');
    expect(content).toContain(`StandardOutput="append:${path.join(projectDir, 'logs', 'scheduler.log')}"`);
    expect(content).toContain(`StandardError="append:${path.join(projectDir, 'logs', 'scheduler.log')}"`);
  });

  it('fails with a build-required error when dist is missing (even if scheduler.sh exists)', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent oven-'));
    tempDirs.push(projectDir);
    fs.writeFileSync(path.join(projectDir, 'scheduler.sh'), '#!/bin/sh\necho legacy\n');

    // Prevent resolveSchedulerCommand() from picking the current vitest entrypoint.
    process.argv = [process.execPath, ''];

    const adapter = new LinuxAdapter();
    await expect(adapter.generateDaemonConfig(projectDir)).rejects.toThrow(
      'Build the project first',
    );
  });
});
