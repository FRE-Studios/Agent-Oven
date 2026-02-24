/**
 * `agent-oven add <id>` — Add a new job
 */

import type { Command } from 'commander';
import { requireConfig, handleError } from '../utils/errors.js';
import { addJob, validateJob } from '../../core/jobs.js';
import { validateCron, validateRandomWindow } from '../../core/scheduler.js';
import { success, error } from '../utils/output.js';
import type { AddJobOptions, Schedule, RandomWindowSchedule } from '../../core/types.js';

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function register(program: Command): void {
  program
    .command('add <id>')
    .description('Add a new job')
    .requiredOption('--name <name>', 'Human-readable job name')
    .option('--type <type>', 'Job type (docker or agent-pipeline)', 'docker')
    .option('--image <image>', 'Docker image (required for docker type)')
    .option('--command <cmd>', 'Command to run (required for docker type; JSON array or string)')
    .option('--repo <url>', 'Git repo URL (required for pipeline type)')
    .option('--pipeline <name>', 'Pipeline name (required for pipeline type)')
    .option('--branch <branch>', 'Git branch (default: main)')
    .option('--schedule <cron>', 'Cron expression (mutually exclusive with --once, --random-window)')
    .option('--once <datetime>', 'ISO 8601 datetime for one-time run')
    .option('--random-window <start-end>', 'Random window in HH:MM-HH:MM format (e.g. 09:30-10:00)')
    .option('--random-window-days <days>', 'Days for random-window (cron weekday syntax, default: *)')
    .option('-v, --volume <vol>', 'Volume mount (repeatable)', collectRepeatable, [])
    .option('-e, --env <kv>', 'Environment variable KEY=VALUE (repeatable)', collectRepeatable, [])
    .option('--timeout <seconds>', 'Timeout in seconds', parseInt)
    .option('--cpus <n>', 'CPU limit', parseFloat)
    .option('--memory <size>', 'Memory limit (e.g., 512m, 2g)')
    .option('--disabled', 'Create job as disabled')
    .action(async (id: string, opts: {
      name: string;
      type: string;
      image?: string;
      command?: string;
      repo?: string;
      pipeline?: string;
      branch?: string;
      schedule?: string;
      once?: string;
      randomWindow?: string;
      randomWindowDays?: string;
      volume: string[];
      env: string[];
      timeout?: number;
      cpus?: number;
      memory?: string;
      disabled?: boolean;
    }) => {
      try {
        const config = requireConfig();

        // Build schedule — exactly one of --schedule, --once, --random-window required
        const schedCount = [opts.schedule, opts.once, opts.randomWindow].filter(Boolean).length;
        if (schedCount === 0) {
          error('One of --schedule, --once, or --random-window is required');
          process.exit(1);
        }
        if (schedCount > 1) {
          error('--schedule, --once, and --random-window are mutually exclusive');
          process.exit(1);
        }

        let schedule: Schedule;
        if (opts.schedule) {
          const cronErr = validateCron(opts.schedule);
          if (cronErr) {
            error(`Invalid cron expression: ${cronErr}`);
            process.exit(1);
          }
          schedule = { type: 'cron', cron: opts.schedule };
        } else if (opts.randomWindow) {
          const rwMatch = opts.randomWindow.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
          if (!rwMatch) {
            error('Invalid --random-window format (expected HH:MM-HH:MM)');
            process.exit(1);
          }
          const rwSchedule: RandomWindowSchedule = {
            type: 'random-window',
            start: rwMatch[1],
            end: rwMatch[2],
            ...(opts.randomWindowDays ? { days: opts.randomWindowDays } : {}),
          };
          const rwErr = validateRandomWindow(rwSchedule);
          if (rwErr) {
            error(`Invalid random-window: ${rwErr}`);
            process.exit(1);
          }
          schedule = rwSchedule;
        } else {
          const d = new Date(opts.once!);
          if (isNaN(d.getTime())) {
            error('Invalid datetime for --once');
            process.exit(1);
          }
          schedule = { type: 'once', datetime: opts.once! };
        }

        // Build env record
        const env: Record<string, string> = {};
        for (const kv of opts.env) {
          const eqIdx = kv.indexOf('=');
          if (eqIdx === -1) {
            error(`Invalid env format: '${kv}' (expected KEY=VALUE)`);
            process.exit(1);
          }
          env[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
        }

        // Build resources
        const resources = (opts.timeout || opts.cpus || opts.memory) ? {
          timeout: opts.timeout,
          cpus: opts.cpus,
          memory: opts.memory,
        } : undefined;

        // Build job options
        let jobOptions: AddJobOptions;

        if (opts.type === 'agent-pipeline') {
          if (!opts.repo) {
            error('--repo is required for pipeline jobs');
            process.exit(1);
          }
          if (!opts.pipeline) {
            error('--pipeline is required for pipeline jobs');
            process.exit(1);
          }
          jobOptions = {
            id,
            name: opts.name,
            type: 'agent-pipeline',
            source: { repo: opts.repo, branch: opts.branch },
            pipeline: opts.pipeline,
            schedule,
            enabled: !opts.disabled,
            ...(Object.keys(env).length > 0 ? { env } : {}),
            ...(resources ? { resources } : {}),
          };
        } else {
          if (!opts.image) {
            error('--image is required for docker jobs');
            process.exit(1);
          }
          if (!opts.command) {
            error('--command is required for docker jobs');
            process.exit(1);
          }

          // Parse command: JSON array or single string
          let command: string | string[];
          if (opts.command.startsWith('[')) {
            try {
              command = JSON.parse(opts.command);
            } catch {
              error('Invalid JSON array for --command');
              process.exit(1);
            }
          } else {
            command = opts.command;
          }

          jobOptions = {
            id,
            name: opts.name,
            type: 'docker',
            image: opts.image,
            command,
            schedule,
            enabled: !opts.disabled,
            ...(opts.volume.length > 0 ? { volumes: opts.volume } : {}),
            ...(Object.keys(env).length > 0 ? { env } : {}),
            ...(resources ? { resources } : {}),
          };
        }

        // Validate
        const errors = validateJob(jobOptions);
        if (errors.length > 0) {
          for (const e of errors) {
            error(e);
          }
          process.exit(1);
        }

        addJob(config, jobOptions);
        success(`Job '${id}' added`);
      } catch (err) {
        handleError(err);
      }
    });
}
