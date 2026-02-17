import { vi } from 'vitest';
vi.mock('node:fs');
import * as fs from 'node:fs';

import {
  validateJob,
  getBuiltInImages,
  listJobs,
  getJob,
  addJob,
  updateJob,
  removeJob,
  toggleJob,
  updateLastRun,
  getJobStats,
} from '../jobs.js';
import type { Job, DockerJob, PipelineJob, AddJobOptions } from '../types.js';
import { makeConfig, makeDockerJob, makePipelineJob } from './fixtures.js';

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

// ─── CRUD Helpers ─────────────────────────────────────────────

const config = makeConfig();

function mockJobsFile(jobs: Job[]): void {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ jobs }));
}

// ─── listJobs ─────────────────────────────────────────────────

describe('listJobs', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns parsed job array when file exists', () => {
    const job = makeDockerJob();
    mockJobsFile([job]);
    expect(listJobs(config)).toEqual([job]);
  });

  it('returns [] when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(listJobs(config)).toEqual([]);
  });

  it('returns [] on readFileSync error', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('EACCES'); });
    expect(listJobs(config)).toEqual([]);
  });

  it('returns [] on corrupt JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json');
    expect(listJobs(config)).toEqual([]);
  });

  it('normalizes legacy jobs without type field to docker', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      jobs: [{ id: 'legacy', name: 'Legacy', image: 'alpine', command: ['echo'], schedule: { type: 'cron', cron: '0 * * * *' } }],
    }));
    const jobs = listJobs(config);
    expect(jobs[0]!.type).toBe('docker');
  });

  it('returns [] when jobs key is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ notJobs: [] }));
    expect(listJobs(config)).toEqual([]);
  });
});

// ─── getJob ───────────────────────────────────────────────────

describe('getJob', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns matching job when found', () => {
    const job = makeDockerJob({ id: 'find-me' });
    mockJobsFile([makeDockerJob({ id: 'other' }), job]);
    expect(getJob(config, 'find-me')).toEqual(job);
  });

  it('returns null when not found', () => {
    mockJobsFile([makeDockerJob()]);
    expect(getJob(config, 'nonexistent')).toBeNull();
  });
});

// ─── addJob ───────────────────────────────────────────────────

describe('addJob', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('adds valid docker job and returns it with last_run: null', () => {
    mockJobsFile([]);
    const result = addJob(config, makeDockerJob({ id: 'new-job' }) as AddJobOptions);
    expect(result.id).toBe('new-job');
    expect(result.last_run).toBeNull();
    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
    expect(written.jobs).toHaveLength(1);
    expect(written.jobs[0].id).toBe('new-job');
  });

  it('adds valid pipeline job', () => {
    mockJobsFile([]);
    const result = addJob(config, makePipelineJob({ id: 'new-pipeline' }) as AddJobOptions);
    expect(result.id).toBe('new-pipeline');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();
  });

  it('throws "already exists" for duplicate ID', () => {
    mockJobsFile([makeDockerJob({ id: 'dup' })]);
    expect(() => addJob(config, makeDockerJob({ id: 'dup' }) as AddJobOptions)).toThrow('already exists');
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it('throws "Missing required fields" when schedule missing', () => {
    mockJobsFile([]);
    const opts = { type: 'docker' as const, id: 'no-sched', name: 'No Schedule', image: 'alpine', command: ['echo'] };
    expect(() => addJob(config, opts as any)).toThrow('Missing required fields');
  });

  it('throws ID format error for invalid chars', () => {
    mockJobsFile([]);
    expect(() => addJob(config, makeDockerJob({ id: 'bad id!' }) as AddJobOptions)).toThrow('letters, numbers, hyphens');
  });

  it('throws "Docker jobs require: image, command" when image missing', () => {
    mockJobsFile([]);
    const opts = { type: 'docker' as const, id: 'no-img', name: 'No Image', command: ['echo'], schedule: { type: 'cron' as const, cron: '0 * * * *' } };
    expect(() => addJob(config, opts as any)).toThrow('Docker jobs require: image, command');
  });

  it('throws "Pipeline jobs require: source, pipeline" when source missing', () => {
    mockJobsFile([]);
    const opts = { type: 'agent-pipeline' as const, id: 'no-src', name: 'No Source', pipeline: 'main', schedule: { type: 'cron' as const, cron: '0 * * * *' } };
    expect(() => addJob(config, opts as any)).toThrow('Pipeline jobs require: source, pipeline');
  });
});

// ─── updateJob ────────────────────────────────────────────────

describe('updateJob', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('merges updates, preserves other fields, and writes', () => {
    const job = makeDockerJob({ id: 'upd', name: 'Original' });
    mockJobsFile([job]);
    const result = updateJob(config, 'upd', { name: 'Updated' });
    expect(result.name).toBe('Updated');
    expect(result.id).toBe('upd');
    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
    expect(written.jobs[0].name).toBe('Updated');
    expect(written.jobs[0].image).toBe('alpine');
  });

  it('throws "not found" for nonexistent job', () => {
    mockJobsFile([]);
    expect(() => updateJob(config, 'ghost', { name: 'Nope' })).toThrow('not found');
  });
});

// ─── removeJob ────────────────────────────────────────────────

describe('removeJob', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('removes correct job and writes shorter array', () => {
    mockJobsFile([makeDockerJob({ id: 'keep' }), makeDockerJob({ id: 'remove-me' })]);
    removeJob(config, 'remove-me');
    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
    expect(written.jobs).toHaveLength(1);
    expect(written.jobs[0].id).toBe('keep');
  });

  it('throws "not found" for nonexistent job', () => {
    mockJobsFile([]);
    expect(() => removeJob(config, 'ghost')).toThrow('not found');
  });
});

// ─── toggleJob ────────────────────────────────────────────────

describe('toggleJob', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('toggles enabled → disabled', () => {
    mockJobsFile([makeDockerJob({ id: 'tog', enabled: true })]);
    const result = toggleJob(config, 'tog');
    expect(result.enabled).toBe(false);
  });

  it('toggles disabled → enabled', () => {
    mockJobsFile([makeDockerJob({ id: 'tog', enabled: false })]);
    const result = toggleJob(config, 'tog');
    expect(result.enabled).toBe(true);
  });

  it('toggles implicit enabled (undefined) → disabled', () => {
    const job = makeDockerJob({ id: 'tog' });
    delete (job as any).enabled;
    mockJobsFile([job]);
    const result = toggleJob(config, 'tog');
    expect(result.enabled).toBe(false);
  });
});

// ─── updateLastRun ────────────────────────────────────────────

describe('updateLastRun', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses provided timestamp verbatim', () => {
    mockJobsFile([makeDockerJob({ id: 'lr' })]);
    const result = updateLastRun(config, 'lr', '2025-01-15T12:00:00');
    expect(result.last_run).toBe('2025-01-15T12:00:00');
  });

  it('generates ISO timestamp without ms when no timestamp given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T10:30:00.000Z'));
    mockJobsFile([makeDockerJob({ id: 'lr' })]);
    const result = updateLastRun(config, 'lr');
    expect(result.last_run).toBe('2025-06-15T10:30:00');
  });
});

// ─── getJobStats ──────────────────────────────────────────────

describe('getJobStats', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns all zeros for empty list', () => {
    mockJobsFile([]);
    expect(getJobStats(config)).toEqual({ total: 0, enabled: 0, cron: 0, oncePending: 0 });
  });

  it('counts mixed jobs correctly', () => {
    mockJobsFile([
      makeDockerJob({ id: 'j1', enabled: true, schedule: { type: 'cron', cron: '0 * * * *' } }),
      makeDockerJob({ id: 'j2', enabled: false, schedule: { type: 'cron', cron: '0 * * * *' } }),
      makeDockerJob({ id: 'j3', schedule: { type: 'once', datetime: '2025-12-25T10:00:00' }, last_run: null }),
      makeDockerJob({ id: 'j4', schedule: { type: 'once', datetime: '2025-12-26T10:00:00' }, last_run: '2025-12-26T10:00:00' }),
    ]);
    const stats = getJobStats(config);
    expect(stats.total).toBe(4);
    expect(stats.enabled).toBe(3); // j1, j3, j4 (enabled !== false)
    expect(stats.cron).toBe(2);    // j1, j2
    expect(stats.oncePending).toBe(1); // j3 (once + no last_run)
  });
});
