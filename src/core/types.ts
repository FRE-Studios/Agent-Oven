/**
 * Core type definitions for Agent Oven
 */

/** Cron schedule - runs on a recurring schedule */
export interface CronSchedule {
  type: 'cron';
  /** Standard 5-field cron expression (minute hour day month weekday) */
  cron: string;
}

/** One-time schedule - runs once at a specific datetime */
export interface OneTimeSchedule {
  type: 'once';
  /** ISO 8601 datetime string (YYYY-MM-DDTHH:MM:SS) */
  datetime: string;
}

/** Random-window schedule - runs once per day at a random time within a window */
export interface RandomWindowSchedule {
  type: 'random-window';
  /** Window start time in HH:MM 24-hour format */
  start: string;
  /** Window end time in HH:MM 24-hour format */
  end: string;
  /** Days of week using cron weekday syntax (0=Sun..6=Sat, 7=Sun), defaults to '*' */
  days?: string;
}

export type Schedule = CronSchedule | OneTimeSchedule | RandomWindowSchedule;

/** Environment variables for a job */
export type EnvVars = Record<string, string>;

/** Auth mode for pipeline jobs */
export type AuthMode = 'host-login' | 'api-key';

/** Source repository configuration for pipeline jobs */
export interface SourceConfig {
  /** Git repository URL */
  repo: string;
  /** Branch to check out (default: "main") */
  branch?: string;
}

/** Resource limits for a job */
export interface ResourceConfig {
  /** Timeout in seconds */
  timeout?: number;
  /** Memory limit (e.g., "512m", "2g") */
  memory?: string;
  /** CPU limit (number of CPUs) */
  cpus?: number;
}

/** Notification configuration */
export interface NotificationConfig {
  /** Slack webhook URL */
  slack?: string;
  /** Notify on failure */
  onFailure?: boolean;
  /** Notify on success */
  onSuccess?: boolean;
}

/** Shared fields for all job types */
interface BaseJob {
  /** Unique identifier for the job */
  id: string;
  /** Human-readable name */
  name: string;
  /** Environment variables */
  env?: EnvVars;
  /** Schedule configuration */
  schedule: Schedule;
  /** Resource limits */
  resources?: ResourceConfig;
  /** Notification settings */
  notifications?: NotificationConfig;
  /** Whether the job is enabled */
  enabled?: boolean;
  /** Last run timestamp (ISO 8601) */
  last_run?: string | null;
}

/** A Docker container job */
export interface DockerJob extends BaseJob {
  type: 'docker';
  /** Docker image to run */
  image: string;
  /** Command to execute (string or array of strings) */
  command: string | string[];
  /** Volume mounts (host:container[:mode]) */
  volumes?: string[];
  /** Timeout in seconds (legacy, prefer resources.timeout) */
  timeout?: number;
}

/** An agent pipeline job */
export interface PipelineJob extends BaseJob {
  type: 'agent-pipeline';
  /** Source repository configuration */
  source: SourceConfig;
  /** Pipeline name to run */
  pipeline: string;
  /** Auth mode override (defaults to config-level default) */
  auth?: AuthMode;
}

/** Discriminated union of all job types */
export type Job = DockerJob | PipelineJob;

/** Type guard for Docker jobs */
export function isDockerJob(job: Job): job is DockerJob {
  return job.type === 'docker';
}

/** Type guard for Pipeline jobs */
export function isPipelineJob(job: Job): job is PipelineJob {
  return job.type === 'agent-pipeline';
}

/** The jobs.json file structure */
export interface JobsFile {
  jobs: Job[];
}

/** Colima configuration */
export interface ColimaConfig {
  cpu: number;
  memory: number;
  disk: number;
}

/** Docker default resource limits */
export interface DockerDefaults {
  defaultCpus: number;
  defaultMemory: string;
}

/** Auth configuration */
export interface AuthConfig {
  /** Default auth mode for pipeline jobs */
  defaultMode: AuthMode;
  /** Path to Claude credentials directory */
  claudeCredPath: string;
  /** Path to GitHub CLI credentials directory */
  ghCredPath: string;
}

/** Application configuration */
export interface Config {
  /** Path to the agent-oven project directory */
  projectDir: string;
  /** Colima VM settings */
  colima: ColimaConfig;
  /** Docker defaults */
  docker: DockerDefaults;
  /** Timezone for schedule evaluation */
  timezone: string;
  /** Auth configuration for pipeline jobs */
  auth?: AuthConfig;
}

/** Status of the container runtime (Colima on macOS, native Docker on Linux) */
export interface RuntimeStatus {
  running: boolean;
  cpu?: number;
  memory?: number;
  disk?: number;
}

/** @deprecated Use RuntimeStatus instead */
export type ColimaStatus = RuntimeStatus;

/** Status of the scheduler daemon */
export interface SchedulerStatus {
  loaded: boolean;
  lastExitStatus?: number;
}

/** A running Docker container */
export interface RunningContainer {
  name: string;
  status: string;
  image: string;
  jobId?: string;
}

/** Job execution log entry */
export interface JobLogEntry {
  jobId: string;
  timestamp: string;
  logFile: string;
  exitCode?: number | 'running';
}

/** Result of running a job */
export interface JobRunResult {
  success: boolean;
  exitCode: number;
  logFile: string;
  output?: string;
}

/** Overall system status */
export interface SystemStatus {
  runtime: RuntimeStatus;
  scheduler: SchedulerStatus;
  jobs: {
    total: number;
    enabled: number;
    cron: number;
    oncePending: number;
    randomWindow: number;
  };
  runningContainers: RunningContainer[];
  recentExecutions: JobLogEntry[];
}

/** Options for adding a new job */
export type AddJobOptions = Omit<DockerJob, 'last_run'> | Omit<PipelineJob, 'last_run'>;

/** Options for updating an existing job */
export type UpdateJobOptions = Partial<Omit<DockerJob, 'id' | 'type'>> | Partial<Omit<PipelineJob, 'id' | 'type'>>;
