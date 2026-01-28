import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { Config, Job, JobLogEntry } from '../../core/types.js';
import { getJob, toggleJob, removeJob } from '../../core/jobs.js';
import { runJob, getRecentExecutions, getJobLogFiles } from '../../core/docker.js';
import { describeSchedule, getNextRun, formatRelativeTime } from '../../core/scheduler.js';

interface JobDetailProps {
  config: Config;
  jobId: string;
  onEdit: (job: Job) => void;
  onViewLogs: (logFile?: string) => void;
  onBack: () => void;
  onMessage: (text: string, type: 'success' | 'error') => void;
}

export function JobDetail({
  config,
  jobId,
  onEdit,
  onViewLogs,
  onBack,
  onMessage,
}: JobDetailProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [recentLogs, setRecentLogs] = useState<JobLogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedLogIndex, setSelectedLogIndex] = useState(0);
  const [logSelectMode, setLogSelectMode] = useState(false);

  // Load job
  const loadJob = useCallback(() => {
    const j = getJob(config, jobId);
    setJob(j);

    if (j) {
      const executions = getRecentExecutions(config, 20);
      const jobExecs = executions.filter((e) => e.jobId === jobId);
      setRecentLogs(jobExecs);
    }
  }, [config, jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  // Handle keyboard input
  useInput((input, key) => {
    if (!job) return;

    if (logSelectMode) {
      if (key.upArrow) {
        setSelectedLogIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedLogIndex((i) => Math.min(recentLogs.length - 1, i + 1));
      } else if (key.return) {
        const log = recentLogs[selectedLogIndex];
        if (log) {
          onViewLogs(log.logFile);
        }
        setLogSelectMode(false);
      } else if (key.escape) {
        setLogSelectMode(false);
      }
      return;
    }

    switch (input) {
      case 'r':
        handleRunJob();
        break;
      case 'e':
        onEdit(job);
        break;
      case ' ':
        handleToggle();
        break;
      case 'd':
        handleDelete();
        break;
      case 'l':
        if (recentLogs.length > 0) {
          setLogSelectMode(true);
          setSelectedLogIndex(0);
        } else {
          onViewLogs();
        }
        break;
    }
  });

  const handleRunJob = async () => {
    if (!job || running) return;

    setRunning(true);
    try {
      const result = await runJob(config, job, { detach: true });
      if (result.success) {
        onMessage(`Job "${job.name}" started`, 'success');
      } else {
        onMessage(`Failed to start: ${result.output}`, 'error');
      }
    } catch (err) {
      onMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setRunning(false);
      loadJob();
    }
  };

  const handleToggle = () => {
    if (!job) return;

    try {
      const updated = toggleJob(config, job.id);
      setJob(updated);
      const status = updated.enabled ? 'enabled' : 'disabled';
      onMessage(`Job "${job.name}" ${status}`, 'success');
    } catch (err) {
      onMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  };

  const handleDelete = () => {
    if (!job) return;

    try {
      removeJob(config, job.id);
      onMessage(`Job "${job.name}" deleted`, 'success');
      onBack();
    } catch (err) {
      onMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  };

  if (!job) {
    return (
      <Box flexDirection="column">
        <Text color="red">Job not found: {jobId}</Text>
        <Box marginTop={1}>
          <Text dimColor>[esc] Back</Text>
        </Box>
      </Box>
    );
  }

  const enabled = job.enabled !== false;
  const scheduleDesc = describeSchedule(job.schedule);
  const nextRun = getNextRun(job.schedule);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="magenta">{job.name}</Text>
        <Text dimColor> ({job.id})</Text>
      </Box>

      {/* Status */}
      <Box marginTop={1}>
        <Text color={enabled ? 'green' : 'red'}>
          {enabled ? '● Enabled' : '○ Disabled'}
        </Text>
        {running && (
          <Box marginLeft={2}>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Running...</Text>
          </Box>
        )}
      </Box>

      {/* Details */}
      <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
        <DetailRow label="Image" value={job.image} />
        <DetailRow
          label="Command"
          value={Array.isArray(job.command) ? job.command.join(' ') : job.command}
        />
        <DetailRow label="Schedule" value={scheduleDesc} />
        {job.schedule.type === 'cron' && (
          <DetailRow label="Cron" value={job.schedule.cron} />
        )}
        {nextRun && (
          <DetailRow label="Next run" value={formatRelativeTime(nextRun)} />
        )}
        {job.timeout && (
          <DetailRow label="Timeout" value={`${job.timeout} seconds`} />
        )}
        {job.volumes && job.volumes.length > 0 && (
          <DetailRow label="Volumes" value={job.volumes.join(', ')} />
        )}
        {job.env && Object.keys(job.env).length > 0 && (
          <DetailRow label="Env vars" value={Object.keys(job.env).join(', ')} />
        )}
        {job.last_run && (
          <DetailRow label="Last run" value={job.last_run} />
        )}
      </Box>

      {/* Recent Logs */}
      {logSelectMode ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Select Log</Text>
          <Box flexDirection="column" borderStyle="single" paddingX={1}>
            {recentLogs.map((log, index) => (
              <Box key={log.timestamp}>
                <Text color={index === selectedLogIndex ? 'cyan' : undefined}>
                  {index === selectedLogIndex ? '▸ ' : '  '}
                  {log.timestamp}
                  <Text dimColor> exit {log.exitCode}</Text>
                </Text>
              </Box>
            ))}
          </Box>
          <Text dimColor>[enter] View  [esc] Cancel</Text>
        </Box>
      ) : recentLogs.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Recent Runs</Text>
          <Box flexDirection="column" borderStyle="single" paddingX={1}>
            {recentLogs.slice(0, 5).map((log) => (
              <LogEntry key={log.timestamp} log={log} />
            ))}
          </Box>
        </Box>
      ) : null}

      {/* Shortcuts */}
      <Box marginTop={1}>
        <Text dimColor>
          [r] Run now  [e] Edit  [space] Toggle  [l] Logs  [d] Delete  [esc] Back
        </Text>
      </Box>
    </Box>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(12)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

interface LogEntryProps {
  log: JobLogEntry;
}

function LogEntry({ log }: LogEntryProps) {
  const isRunning = log.exitCode === 'running';
  const isSuccess = log.exitCode === 0;

  return (
    <Box>
      <Text color={isRunning ? 'yellow' : isSuccess ? 'green' : 'red'}>
        {isRunning ? '◐' : isSuccess ? '✓' : '✗'}
      </Text>
      <Text> {log.timestamp}</Text>
      <Text dimColor> {isRunning ? 'running' : `exit ${log.exitCode}`}</Text>
    </Box>
  );
}
