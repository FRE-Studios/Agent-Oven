import { isDockerJob, isPipelineJob } from '../types.js';
import type { DockerJob, PipelineJob } from '../types.js';

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

describe('isDockerJob', () => {
  it('returns true for docker job', () => {
    expect(isDockerJob(dockerJob)).toBe(true);
  });

  it('returns false for pipeline job', () => {
    expect(isDockerJob(pipelineJob)).toBe(false);
  });
});

describe('isPipelineJob', () => {
  it('returns true for pipeline job', () => {
    expect(isPipelineJob(pipelineJob)).toBe(true);
  });

  it('returns false for docker job', () => {
    expect(isPipelineJob(dockerJob)).toBe(false);
  });

  it('isDockerJob and isPipelineJob are mutually exclusive', () => {
    expect(isDockerJob(dockerJob)).not.toBe(isPipelineJob(dockerJob));
    expect(isDockerJob(pipelineJob)).not.toBe(isPipelineJob(pipelineJob));
  });
});
