/**
 * Shared test fixtures for Agent Oven test suite.
 * Factory functions return fresh copies so tests don't share state.
 */

import type { Config, DockerJob, PipelineJob, AuthConfig } from '../types.js';

export function makeConfig(overrides?: Partial<Config>): Config {
  return {
    projectDir: '/tmp/test-project',
    colima: { cpu: 2, memory: 4, disk: 20 },
    docker: { defaultCpus: 1, defaultMemory: '512m' },
    timezone: 'America/Los_Angeles',
    auth: {
      defaultMode: 'host-login',
      claudeCredPath: '/tmp/.claude',
      ghCredPath: '/tmp/.config/gh',
    },
    ...overrides,
  };
}

export function makeDockerJob(overrides?: Partial<DockerJob>): DockerJob {
  return {
    type: 'docker',
    id: 'test-docker',
    name: 'Test Docker Job',
    image: 'alpine',
    command: ['echo', 'hello'],
    schedule: { type: 'cron', cron: '0 * * * *' },
    ...overrides,
  };
}

export function makePipelineJob(overrides?: Partial<PipelineJob>): PipelineJob {
  return {
    type: 'agent-pipeline',
    id: 'test-pipeline',
    name: 'Test Pipeline Job',
    source: { repo: 'https://github.com/test/repo' },
    pipeline: 'main',
    schedule: { type: 'cron', cron: '0 9 * * *' },
    ...overrides,
  };
}

export function makeAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    defaultMode: 'host-login',
    claudeCredPath: '/tmp/.claude',
    ghCredPath: '/tmp/.config/gh',
    ...overrides,
  };
}
