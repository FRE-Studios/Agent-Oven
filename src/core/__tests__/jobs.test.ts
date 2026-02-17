import { validateJob, getBuiltInImages } from '../jobs.js';
import type { DockerJob, PipelineJob } from '../types.js';

// ─── validateJob ────────────────────────────────────────────

describe('validateJob', () => {
  const validDockerJob: DockerJob = {
    type: 'docker',
    id: 'my-job',
    name: 'My Job',
    image: 'alpine',
    command: ['echo', 'hello'],
    schedule: { type: 'cron', cron: '0 * * * *' },
  };

  const validPipelineJob: PipelineJob = {
    type: 'agent-pipeline',
    id: 'my-pipeline',
    name: 'My Pipeline',
    source: { repo: 'https://github.com/test/repo' },
    pipeline: 'main',
    schedule: { type: 'cron', cron: '0 9 * * *' },
  };

  // Valid jobs return no errors
  it('returns empty array for valid docker job', () => {
    expect(validateJob(validDockerJob)).toEqual([]);
  });

  it('returns empty array for valid pipeline job', () => {
    expect(validateJob(validPipelineJob)).toEqual([]);
  });

  // Missing ID
  it('reports missing job ID', () => {
    const errors = validateJob({ ...validDockerJob, id: '' });
    expect(errors).toContain('Job ID is required');
  });

  it('reports missing job ID (undefined)', () => {
    const { id, ...noId } = validDockerJob;
    const errors = validateJob(noId);
    expect(errors).toContain('Job ID is required');
  });

  // Invalid ID format
  it('reports invalid ID with spaces', () => {
    const errors = validateJob({ ...validDockerJob, id: 'my job' });
    expect(errors.some((e) => e.includes('letters, numbers, hyphens'))).toBe(true);
  });

  it('reports invalid ID with special chars', () => {
    const errors = validateJob({ ...validDockerJob, id: 'my-job!' });
    expect(errors.some((e) => e.includes('letters, numbers, hyphens'))).toBe(true);
  });

  it('accepts ID with hyphens and underscores', () => {
    const errors = validateJob({ ...validDockerJob, id: 'my-job_v2' });
    expect(errors).toEqual([]);
  });

  // Missing name
  it('reports missing job name', () => {
    const errors = validateJob({ ...validDockerJob, name: '' });
    expect(errors).toContain('Job name is required');
  });

  it('reports missing job name (undefined)', () => {
    const { name, ...noName } = validDockerJob;
    const errors = validateJob(noName);
    expect(errors).toContain('Job name is required');
  });

  // Docker-specific: missing image
  it('reports missing docker image', () => {
    const { image, ...noImage } = validDockerJob;
    const errors = validateJob(noImage);
    expect(errors).toContain('Docker image is required');
  });

  // Docker-specific: missing command
  it('reports missing docker command', () => {
    const { command, ...noCommand } = validDockerJob;
    const errors = validateJob(noCommand);
    expect(errors).toContain('Command is required');
  });

  // Pipeline-specific: missing source
  it('reports missing pipeline source', () => {
    const { source, ...noSource } = validPipelineJob;
    const errors = validateJob(noSource);
    expect(errors).toContain('Source configuration is required for pipeline jobs');
  });

  // Pipeline-specific: missing source.repo
  it('reports missing source repo', () => {
    const errors = validateJob({ ...validPipelineJob, source: { repo: '' } });
    expect(errors).toContain('Source repo URL is required');
  });

  // Pipeline-specific: missing pipeline name
  it('reports missing pipeline name', () => {
    const { pipeline, ...noPipeline } = validPipelineJob;
    const errors = validateJob(noPipeline);
    expect(errors).toContain('Pipeline name is required');
  });

  // Missing schedule
  it('reports missing schedule', () => {
    const { schedule, ...noSchedule } = validDockerJob;
    const errors = validateJob(noSchedule);
    expect(errors).toContain('Schedule is required');
  });

  // Cron schedule with wrong fields
  it('reports cron with wrong number of fields', () => {
    const errors = validateJob({ ...validDockerJob, schedule: { type: 'cron', cron: '* * *' } });
    expect(errors.some((e) => e.includes('5 fields'))).toBe(true);
  });

  // Once schedule with invalid datetime
  it('reports once schedule with invalid datetime', () => {
    const errors = validateJob({
      ...validDockerJob,
      schedule: { type: 'once', datetime: 'not-a-date' },
    });
    expect(errors).toContain('Invalid datetime format');
  });

  // Valid once schedule
  it('accepts valid once schedule', () => {
    const errors = validateJob({
      ...validDockerJob,
      schedule: { type: 'once', datetime: '2025-12-25T10:00:00' },
    });
    expect(errors).toEqual([]);
  });

  // Resource validation
  it('reports negative resources.timeout', () => {
    const errors = validateJob({ ...validDockerJob, resources: { timeout: -1 } });
    expect(errors).toContain('Resources timeout must be a positive number');
  });

  it('accepts zero resources.timeout', () => {
    const errors = validateJob({ ...validDockerJob, resources: { timeout: 0 } });
    expect(errors).toEqual([]);
  });

  it('reports zero resources.cpus', () => {
    const errors = validateJob({ ...validDockerJob, resources: { cpus: 0 } });
    expect(errors).toContain('Resources CPUs must be a positive number');
  });

  it('reports negative resources.cpus', () => {
    const errors = validateJob({ ...validDockerJob, resources: { cpus: -1 } });
    expect(errors).toContain('Resources CPUs must be a positive number');
  });

  it('accepts valid resources', () => {
    const errors = validateJob({ ...validDockerJob, resources: { timeout: 300, cpus: 2, memory: '1g' } });
    expect(errors).toEqual([]);
  });

  // Legacy timeout validation
  it('reports negative legacy timeout', () => {
    const errors = validateJob({ ...validDockerJob, timeout: -1 });
    expect(errors).toContain('Timeout must be a positive number');
  });

  it('accepts zero legacy timeout', () => {
    const errors = validateJob({ ...validDockerJob, timeout: 0 });
    expect(errors).toEqual([]);
  });

  // Multiple errors at once
  it('accumulates multiple errors', () => {
    const errors = validateJob({ type: 'docker' } as Partial<DockerJob>);
    expect(errors.length).toBeGreaterThanOrEqual(3); // id, name, image, command, schedule
  });
});

// ─── getBuiltInImages ───────────────────────────────────────

describe('getBuiltInImages', () => {
  it('returns expected images', () => {
    const images = getBuiltInImages();
    expect(images).toContain('agent-oven/base-tasks');
    expect(images).toContain('agent-oven/python-tasks');
    expect(images).toContain('agent-oven/node-tasks');
    expect(images).toContain('agent-oven/pipeline-runner');
  });

  it('returns exactly 4 images', () => {
    expect(getBuiltInImages()).toHaveLength(4);
  });
});
