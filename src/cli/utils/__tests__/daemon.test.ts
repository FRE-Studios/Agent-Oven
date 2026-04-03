import { beforeEach, describe, expect, it, vi } from 'vitest';

const { platformMock, outputMock } = vi.hoisted(() => ({
  platformMock: {
    validateDaemonConfig: vi.fn(),
    getDaemonProjectDir: vi.fn(),
    getDaemonConfigPath: vi.fn(),
    installDaemon: vi.fn(),
  },
  outputMock: {
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../../core/platform.js', () => ({
  platform: platformMock,
}));

vi.mock('../output.js', () => outputMock);

import { repairStaleDaemonConfig, warnIfDaemonConfigStale } from '../daemon.js';

describe('daemon utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.getDaemonConfigPath.mockReturnValue('/tmp/agent-oven.service');
  });

  describe('warnIfDaemonConfigStale', () => {
    it('returns false when the daemon config is valid', () => {
      platformMock.validateDaemonConfig.mockReturnValue(null);

      expect(warnIfDaemonConfigStale()).toBe(false);
      expect(outputMock.warn).not.toHaveBeenCalled();
    });

    it('warns when the daemon config is stale', () => {
      platformMock.validateDaemonConfig.mockReturnValue('stale daemon');

      expect(warnIfDaemonConfigStale()).toBe(true);
      expect(outputMock.warn).toHaveBeenCalledWith('stale daemon');
    });
  });

  describe('repairStaleDaemonConfig', () => {
    it('reinstalls the daemon for the project referenced by the current config', async () => {
      platformMock.validateDaemonConfig.mockReturnValue('stale daemon');
      platformMock.getDaemonProjectDir.mockReturnValue('/opt/agent-oven');
      platformMock.installDaemon.mockResolvedValue({ success: true });

      await expect(repairStaleDaemonConfig()).resolves.toBe(true);
      expect(platformMock.installDaemon).toHaveBeenCalledWith('/opt/agent-oven');
      expect(outputMock.success).toHaveBeenCalledWith(
        'Daemon config regenerated with current Node path for /opt/agent-oven.',
      );
    });

    it('throws when the existing config cannot be mapped back to a project', async () => {
      platformMock.validateDaemonConfig.mockReturnValue('stale daemon');
      platformMock.getDaemonProjectDir.mockReturnValue(null);

      await expect(repairStaleDaemonConfig()).rejects.toThrow(
        'Run `agent-oven init` from the intended project directory to regenerate it.',
      );
      expect(platformMock.installDaemon).not.toHaveBeenCalled();
    });
  });
});
