/**
 * `agent-oven logs [id]` — View logs
 */

import * as fs from 'node:fs';
import type { Command } from 'commander';
import { requireConfig, handleError } from '../utils/errors.js';
import { readSchedulerLog, getJobLogFiles, readJobLog } from '../../core/docker.js';
import { getJob } from '../../core/jobs.js';
import { error, info } from '../utils/output.js';

export function register(program: Command): void {
  program
    .command('logs [id]')
    .description('View logs (scheduler log if no id, job log if id given)')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .option('--all', 'List available log files for a job')
    .option('--run <n>', 'Nth most recent run (default: 1)', '1')
    .option('-f, --follow', 'Follow log output')
    .action(async (id: string | undefined, opts: {
      lines: string;
      all?: boolean;
      run: string;
      follow?: boolean;
    }) => {
      try {
        const config = requireConfig();
        const lines = parseInt(opts.lines, 10) || 50;
        const runIndex = parseInt(opts.run, 10) - 1;

        if (!id) {
          // Scheduler log
          if (opts.follow) {
            await followLog(config, null, lines);
          } else {
            const log = readSchedulerLog(config, lines);
            if (!log) {
              info('No scheduler log found');
            } else {
              console.log(log);
            }
          }
          return;
        }

        // Job log
        const job = getJob(config, id);
        if (!job) {
          error(`Job '${id}' not found`);
          process.exit(1);
        }

        const logFiles = getJobLogFiles(config, id);
        if (logFiles.length === 0) {
          info(`No logs found for job '${id}'`);
          return;
        }

        if (opts.all) {
          info(`Log files for '${id}':`);
          logFiles.forEach((f, i) => {
            const basename = f.split('/').pop() ?? f;
            console.log(`  ${i + 1}. ${basename}`);
          });
          return;
        }

        if (runIndex >= logFiles.length) {
          error(`Only ${logFiles.length} log file(s) available for job '${id}'`);
          process.exit(1);
        }

        const logFile = logFiles[runIndex];

        if (opts.follow) {
          await followLog(config, logFile, lines);
        } else {
          const content = readJobLog(logFile);
          const allLines = content.split('\n');
          const output = allLines.slice(-lines).join('\n');
          console.log(output);
        }
      } catch (err) {
        handleError(err);
      }
    });
}

/**
 * Tail -f behavior: print last N lines, then poll for new content
 */
async function followLog(_config: unknown, logFile: string | null, lines: number): Promise<void> {
  let filePath: string;
  if (logFile) {
    filePath = logFile;
  } else {
    const { getSchedulerLogPath } = await import('../../core/config.js');
    const { loadConfig } = await import('../../core/config.js');
    filePath = getSchedulerLogPath(loadConfig());
  }

  if (!fs.existsSync(filePath)) {
    info('Waiting for log file...');
  }

  let lastSize = 0;

  // Print initial content
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');
    console.log(allLines.slice(-lines).join('\n'));
    lastSize = Buffer.byteLength(content, 'utf-8');
  }

  // Poll for new content
  const interval = setInterval(() => {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size > lastSize) {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      process.stdout.write(buf.toString('utf-8'));
      lastSize = stat.size;
    }
  }, 500);

  // Wait for Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}
