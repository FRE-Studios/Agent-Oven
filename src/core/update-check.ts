/**
 * Lightweight update checker for agent-oven.
 *
 * Hits the npm registry at most once per 24 hours, caches the result
 * to ~/.config/agent-oven/update-check.json, and never throws.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = 'https://registry.npmjs.org/agent-oven/latest';
const FETCH_TIMEOUT_MS = 5000;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

interface CacheFile {
  lastChecked: string;
  latestVersion: string;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function getCacheDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'agent-oven');
  }
  return path.join(os.homedir(), '.config', 'agent-oven');
}

function getCachePath(): string {
  return path.join(getCacheDir(), 'update-check.json');
}

function getCurrentVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const { version } = require('../../package.json');
    return version as string;
  } catch {
    return '0.0.0';
  }
}

function readCache(): CacheFile | null {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8');
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(latestVersion: string): void {
  try {
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: CacheFile = {
      lastChecked: new Date().toISOString(),
      latestVersion,
    };
    fs.writeFileSync(getCachePath(), JSON.stringify(data, null, 2) + '\n');
  } catch {
    // Silently ignore write errors
  }
}

function isCacheFresh(cache: CacheFile): boolean {
  try {
    const lastChecked = new Date(cache.lastChecked).getTime();
    return Date.now() - lastChecked < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function parseSemver(version: string): ParsedSemver | null {
  const normalized = version.trim().replace(/^v/, '');
  const match = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/,
  );
  if (!match) return null;

  const prerelease = match[4] ? match[4].split('.') : [];
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);

  if (aNumeric && bNumeric) {
    const aNum = Number(a);
    const bNum = Number(b);
    return aNum === bNum ? 0 : aNum > bNum ? 1 : -1;
  }

  if (aNumeric && !bNumeric) return -1;
  if (!aNumeric && bNumeric) return 1;
  return a === b ? 0 : a > b ? 1 : -1;
}

function compareSemver(a: string, b: string): number | null {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;

  if (parsedA.major !== parsedB.major) return parsedA.major > parsedB.major ? 1 : -1;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor > parsedB.minor ? 1 : -1;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch > parsedB.patch ? 1 : -1;

  const aPre = parsedA.prerelease;
  const bPre = parsedB.prerelease;

  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const maxLen = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLen; i += 1) {
    const aId = aPre[i];
    const bId = bPre[i];
    if (aId === undefined) return -1;
    if (bId === undefined) return 1;

    const comparison = comparePrereleaseIdentifier(aId, bId);
    if (comparison !== 0) return comparison;
  }

  return 0;
}

function buildUpdateInfo(latestVersion: string): UpdateInfo {
  const currentVersion = getCurrentVersion();
  const comparison = compareSemver(latestVersion, currentVersion);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: comparison === null ? false : comparison > 0,
  };
}

/**
 * Check for an available update. Uses a 24-hour cache to avoid
 * hitting the registry on every invocation. Never throws.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const cache = readCache();
    if (cache && isCacheFresh(cache)) {
      return buildUpdateInfo(cache.latestVersion);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timer.unref?.();

    try {
      const res = await fetch(REGISTRY_URL, { signal: controller.signal });
      if (!res.ok) return null;

      const data = (await res.json()) as { version?: string };
      const latestVersion = data.version;
      if (!latestVersion) return null;

      writeCache(latestVersion);
      return buildUpdateInfo(latestVersion);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Synchronously read cached update info (for TUI use without async).
 * Returns null if no cache exists or on any error.
 */
export function getCachedUpdateInfo(): UpdateInfo | null {
  try {
    const cache = readCache();
    if (!cache) return null;
    return buildUpdateInfo(cache.latestVersion);
  } catch {
    return null;
  }
}
