import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Config, SystemStatus } from '../../core/types.js';
import type { Screen } from '../types.js';
import { getSystemStatus } from '../../core/docker.js';
import { formatRelativeTime } from '../../core/scheduler.js';

interface DashboardProps {
  config: Config;
  onNavigate: (screen: Screen) => void;
}

export function Dashboard({ config, onNavigate }: DashboardProps) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load status on mount
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const s = await getSystemStatus(config);
        setStatus(s);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load status');
      } finally {
        setLoading(false);
      }
    };

    loadStatus();

    // Refresh every 10 seconds
    const interval = setInterval(loadStatus, 10000);
    return () => clearInterval(interval);
  }, [config]);

  if (loading && !status) {
    return (
      <Box flexDirection="column">
        <Header />
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Loading status...</Text>
        </Box>
      </Box>
    );
  }

  if (error && !status) {
    return (
      <Box flexDirection="column">
        <Header />
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
        <Shortcuts />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header />

      {/* System Status */}
      <Box marginTop={1}>
        <Text bold>Status: </Text>
        <StatusIndicator
          running={status?.colima.running ?? false}
          label="Colima"
        />
        <Text>   </Text>
        <StatusIndicator
          running={status?.scheduler.loaded ?? false}
          label="Scheduler"
        />
      </Box>

      {/* Jobs Summary */}
      <Box marginTop={1}>
        <Text bold>Jobs: </Text>
        <Text>{status?.jobs.total ?? 0} total</Text>
        <Text dimColor> | </Text>
        <Text>{status?.jobs.cron ?? 0} cron</Text>
        <Text dimColor> | </Text>
        <Text>{status?.jobs.oncePending ?? 0} pending one-time</Text>
      </Box>

      {/* Running Containers */}
      {status?.runningContainers && status.runningContainers.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Running Jobs</Text>
          {status.runningContainers.map((container) => (
            <Box key={container.name}>
              <Text color="cyan">{container.jobId || container.name}</Text>
              <Text dimColor> - {container.status}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Recent Executions */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>Recent Runs</Text>
        <Box borderStyle="single" flexDirection="column" paddingX={1}>
          {(!status?.recentExecutions || status.recentExecutions.length === 0) ? (
            <Text dimColor>No recent executions</Text>
          ) : (
            status.recentExecutions.slice(0, 5).map((exec) => (
              <RecentExecution key={`${exec.jobId}-${exec.timestamp}`} execution={exec} />
            ))
          )}
        </Box>
      </Box>

      <Shortcuts />
    </Box>
  );
}

function Header() {
  return (
    <Box>
      <Text bold color="magenta">Agent Oven</Text>
      <Text dimColor> - Job Scheduler</Text>
    </Box>
  );
}

function StatusIndicator({ running, label }: { running: boolean; label: string }) {
  return (
    <Text>
      <Text color={running ? 'green' : 'red'}>{running ? '●' : '○'}</Text>
      <Text> {label} {running ? 'running' : 'stopped'}</Text>
    </Text>
  );
}

interface RecentExecutionProps {
  execution: {
    jobId: string;
    timestamp: string;
    exitCode?: number | 'running';
  };
}

function RecentExecution({ execution }: RecentExecutionProps) {
  const { jobId, timestamp, exitCode } = execution;

  // Parse timestamp (format: YYYYMMDD-HHMMSS)
  let timeAgo = timestamp;
  try {
    const year = timestamp.slice(0, 4);
    const month = timestamp.slice(4, 6);
    const day = timestamp.slice(6, 8);
    const hour = timestamp.slice(9, 11);
    const minute = timestamp.slice(11, 13);
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
    if (!isNaN(date.getTime())) {
      timeAgo = formatRelativeTime(date);
    }
  } catch {
    // Keep original timestamp
  }

  const isRunning = exitCode === 'running';
  const isSuccess = exitCode === 0;

  return (
    <Box>
      <Text color={isRunning ? 'cyan' : isSuccess ? 'green' : 'red'}>
        {isRunning ? '◐' : isSuccess ? '✓' : '✗'}
      </Text>
      <Text> </Text>
      <Text>{jobId.padEnd(20)}</Text>
      <Text dimColor>{timeAgo.padEnd(15)}</Text>
      <Text dimColor>
        {isRunning ? 'running' : `exit ${exitCode}`}
      </Text>
    </Box>
  );
}

function Shortcuts() {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        [j] Jobs  [a] Add Job  [l] Logs  [q] Quit
      </Text>
    </Box>
  );
}
