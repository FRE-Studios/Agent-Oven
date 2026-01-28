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

export type Schedule = CronSchedule | OneTimeSchedule;

/** Environment variables for a job */
export type EnvVars = Record<string, string>;

/** A scheduled job definition */
export interface Job {
  /** Unique identifier for the job */
  id: string;
  /** Human-readable name */
  name: string;
  /** Docker image to run */
  image: string;
  /** Command to execute (string or array of strings) */
  command: string | string[];
  /** Volume mounts (host:container[:mode]) */
  volumes?: string[];
  /** Environment variables */
  env?: EnvVars;
  /** Schedule configuration */
  schedule: Schedule;
  /** Timeout in seconds */
  timeout?: number;
  /** Whether the job is enabled */
  enabled?: boolean;
  /** Last run timestamp (ISO 8601) */
  last_run?: string | null;
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
}

/** Status of Colima VM */
export interface ColimaStatus {
  running: boolean;
  cpu?: number;
  memory?: number;
  disk?: number;
}

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
  colima: ColimaStatus;
  scheduler: SchedulerStatus;
  jobs: {
    total: number;
    enabled: number;
    cron: number;
    oncePending: number;
  };
  runningContainers: RunningContainer[];
  recentExecutions: JobLogEntry[];
}

/** Options for adding a new job */
export type AddJobOptions = Omit<Job, 'last_run'>;

/** Options for updating an existing job */
export type UpdateJobOptions = Partial<Omit<Job, 'id'>>;
