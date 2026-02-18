import { vi } from 'vitest';
vi.mock('node:fs');
import * as fs from 'node:fs';
import { createRequire } from 'node:module';

import { checkForUpdate, getCachedUpdateInfo } from '../update-check.js';

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

function parseCoreVersion(version: string): VersionParts | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function getCurrentPackageVersion(): string {
  const require = createRequire(import.meta.url);
  const { version } = require('../../../package.json') as { version: string };
  return version;
}

function makeHigherVersion(current: string): string {
  const parts = parseCoreVersion(current);
  if (!parts) return '999.0.0';
  return `${parts.major + 1}.0.0`;
}

function makeLowerVersion(current: string): string {
  const parts = parseCoreVersion(current);
  if (!parts) return '0.0.0-alpha.1';
  if (parts.patch > 0) return `${parts.major}.${parts.minor}.${parts.patch - 1}`;
  if (parts.minor > 0) return `${parts.major}.${parts.minor - 1}.0`;
  if (parts.major > 0) return `${parts.major - 1}.0.0`;
  return '0.0.0-alpha.1';
}

describe('getCachedUpdateInfo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('only reports update when cached version is semver-greater', () => {
    const current = getCurrentPackageVersion();
    const higher = makeHigherVersion(current);
    const lower = makeLowerVersion(current);

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastChecked: new Date().toISOString(),
      latestVersion: higher,
    }));
    const higherInfo = getCachedUpdateInfo();
    expect(higherInfo?.updateAvailable).toBe(true);

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastChecked: new Date().toISOString(),
      latestVersion: lower,
    }));
    const lowerInfo = getCachedUpdateInfo();
    expect(lowerInfo?.updateAvailable).toBe(false);
  });

  it('does not report update for unparsable versions', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastChecked: new Date().toISOString(),
      latestVersion: 'main',
    }));

    const info = getCachedUpdateInfo();
    expect(info?.updateAvailable).toBe(false);
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears timeout when fetch fails quickly', async () => {
    vi.useFakeTimers();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkForUpdate();

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
