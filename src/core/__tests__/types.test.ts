import { isDockerJob, isPipelineJob, isHostJob } from '../types.js';
import type { DockerJob, PipelineJob, HostJob } from '../types.js';

const dockerJob: DockerJob = {
  type: 'docker',
  id: 'test-docker',
  name: 'Test Docker Job',
  image: 'alpine',
  command: ['echo', 'hello'],
  schedule: { type: 'cron', cron: '* * * * *' },
};

const pipelineJob: PipelineJob = {
  type: 'agent-pipeline',
  id: 'test-pipeline',
  name: 'Test Pipeline Job',
  source: { repo: 'https://github.com/test/repo' },
  pipeline: 'main',
  schedule: { type: 'cron', cron: '0 9 * * *' },
};

const hostJob: HostJob = {
  type: 'host',
  id: 'test-host',
  name: 'Test Host Job',
  command: ['echo', 'hello'],
  schedule: { type: 'cron', cron: '0 * * * *' },
};

describe('isDockerJob', () => {
  it('returns true for docker job', () => {
    expect(isDockerJob(dockerJob)).toBe(true);
  });

  it('returns false for pipeline job', () => {
    expect(isDockerJob(pipelineJob)).toBe(false);
  });

  it('returns false for host job', () => {
    expect(isDockerJob(hostJob)).toBe(false);
  });
});

describe('isPipelineJob', () => {
  it('returns true for pipeline job', () => {
    expect(isPipelineJob(pipelineJob)).toBe(true);
  });

  it('returns false for docker job', () => {
    expect(isPipelineJob(dockerJob)).toBe(false);
  });

  it('returns false for host job', () => {
    expect(isPipelineJob(hostJob)).toBe(false);
  });
});

describe('isHostJob', () => {
  it('returns true for host job', () => {
    expect(isHostJob(hostJob)).toBe(true);
  });

  it('returns false for docker job', () => {
    expect(isHostJob(dockerJob)).toBe(false);
  });

  it('returns false for pipeline job', () => {
    expect(isHostJob(pipelineJob)).toBe(false);
  });
});

describe('job type guards', () => {
  it('exactly one guard matches each job type', () => {
    for (const job of [dockerJob, pipelineJob, hostJob]) {
      const matches = [isDockerJob(job), isPipelineJob(job), isHostJob(job)].filter(Boolean);
      expect(matches).toHaveLength(1);
    }
  });
});
