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

function buildUpdateInfo(latestVersion: string): UpdateInfo {
  const currentVersion = getCurrentVersion();
  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion !== currentVersion,
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

    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = (await res.json()) as { version?: string };
    const latestVersion = data.version;
    if (!latestVersion) return null;

    writeCache(latestVersion);
    return buildUpdateInfo(latestVersion);
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
