/**
 * Authentication management for pipeline jobs
 * Handles credential mounting and validation for Claude and GitHub
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthMode, AuthConfig, PipelineJob } from './types.js';

/** Default auth configuration */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  defaultMode: 'host-login',
  claudeCredPath: path.join(os.homedir(), '.claude'),
  ghCredPath: path.join(os.homedir(), '.config', 'gh'),
};

/** Health status for individual credentials */
export interface AuthHealthStatus {
  claude: { available: boolean; error?: string; warning?: string };
  github: { available: boolean; error?: string; warning?: string };
}

/**
 * Resolve which auth mode to use for a job.
 * Job-level override takes precedence over default.
 */
export function resolveAuthMode(job: PipelineJob, authConfig: AuthConfig): AuthMode {
  return job.auth ?? authConfig.defaultMode;
}

/**
 * Generate Docker volume mounts and env vars for auth.
 */
export function generateAuthArgs(
  authMode: AuthMode,
  authConfig: AuthConfig,
  jobEnv?: Record<string, string>,
): { volumes: string[]; envVars: Record<string, string> } {
  const volumes: string[] = [];
  const envVars: Record<string, string> = {};

  if (authMode === 'host-login') {
    // Mount credential directories
    // .claude and .claude.json need read-write: Claude Code writes debug logs,
    // task tracking, and uses atomic-rename on .claude.json
    // .config/gh is read-only: gh CLI only reads credentials
    const claudePath = authConfig.claudeCredPath;
    const claudeJsonPath = `${claudePath}.json`; // ~/.claude.json (sibling config file)
    const ghPath = authConfig.ghCredPath;

    if (fs.existsSync(claudePath)) {
      volumes.push(`${claudePath}:/root/.claude`);
    }
    if (fs.existsSync(claudeJsonPath)) {
      volumes.push(`${claudeJsonPath}:/root/.claude.json`);
    }
    if (fs.existsSync(ghPath)) {
      volumes.push(`${ghPath}:/root/.config/gh:ro`);
    }
  } else if (authMode === 'api-key') {
    // Pass API keys from job env or process env
    const anthropicKey = jobEnv?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const ghToken = jobEnv?.GH_TOKEN ?? jobEnv?.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

    if (anthropicKey) {
      envVars.ANTHROPIC_API_KEY = anthropicKey;
    }
    if (ghToken) {
      envVars.GH_TOKEN = ghToken;
    }
  }

  return { volumes, envVars };
}

/**
 * Check health of auth credentials on the host.
 */
export function checkAuthHealth(authConfig: AuthConfig): AuthHealthStatus {
  const claudePath = authConfig.claudeCredPath;
  const claudeJsonPath = `${claudePath}.json`;
  const ghPath = authConfig.ghCredPath;

  const claude = checkCredentialPath(claudePath, 'Claude');
  const github = checkCredentialPath(ghPath, 'GitHub CLI');

  // Warn if ~/.claude dir is healthy but ~/.claude.json is missing
  if (claude.available && !fs.existsSync(claudeJsonPath)) {
    claude.warning = `Claude config file not found: ${claudeJsonPath} (required by newer Claude Code versions)`;
  }

  return { claude, github };
}

function checkCredentialPath(
  credPath: string,
  label: string,
): { available: boolean; error?: string; warning?: string } {
  if (!fs.existsSync(credPath)) {
    return { available: false, error: `${label} credential path not found: ${credPath}` };
  }

  try {
    const stat = fs.statSync(credPath);
    if (!stat.isDirectory()) {
      return { available: false, error: `${label} credential path is not a directory: ${credPath}` };
    }

    const contents = fs.readdirSync(credPath);
    if (contents.length === 0) {
      return { available: false, error: `${label} credential directory is empty: ${credPath}` };
    }

    return { available: true };
  } catch (err) {
    return { available: false, error: `${label} credential check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Validate that auth requirements are met for a pipeline job.
 * Throws if credentials are missing for the resolved auth mode.
 * Returns an array of non-fatal warnings (e.g. missing ~/.claude.json).
 */
export function validateAuthForJob(job: PipelineJob, authConfig: AuthConfig): string[] {
  const mode = resolveAuthMode(job, authConfig);
  const warnings: string[] = [];

  if (mode === 'host-login') {
    const health = checkAuthHealth(authConfig);
    const errors: string[] = [];

    if (!health.claude.available) {
      errors.push(health.claude.error ?? 'Claude credentials not available');
    } else if (health.claude.warning) {
      warnings.push(health.claude.warning);
    }
    if (!health.github.available) {
      errors.push(health.github.error ?? 'GitHub credentials not available');
    }

    if (errors.length > 0) {
      throw new Error(`Auth validation failed for job "${job.id}":\n  ${errors.join('\n  ')}`);
    }
  } else if (mode === 'api-key') {
    const anthropicKey = job.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const ghToken = job.env?.GH_TOKEN ?? job.env?.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

    const errors: string[] = [];
    if (!anthropicKey) {
      errors.push('ANTHROPIC_API_KEY not set in job env or process env');
    }
    if (!ghToken) {
      errors.push('GH_TOKEN/GITHUB_TOKEN not set in job env or process env');
    }

    if (errors.length > 0) {
      throw new Error(`Auth validation failed for job "${job.id}":\n  ${errors.join('\n  ')}`);
    }
  }

  return warnings;
}
