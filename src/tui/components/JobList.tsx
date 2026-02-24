import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Config, Job } from '../../core/types.js';
import { listJobs, toggleJob, removeJob } from '../../core/jobs.js';
import { runJob } from '../../core/docker.js';
import { describeSchedule } from '../../core/scheduler.js';

interface JobListProps {
  config: Config;
  onSelect: (job: Job) => void;
  onAdd: () => void;
  onBack: () => void;
  onMessage: (text: string, type: 'success' | 'error') => void;
}

export function JobList({ config, onSelect, onAdd, onBack, onMessage }: JobListProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  // Load jobs
  const loadJobs = useCallback(() => {
    const allJobs = listJobs(config);
    setJobs(allJobs);
  }, [config]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Filter jobs
  const filteredJobs = jobs.filter((job) => {
    if (!filter) return true;
    const search = filter.toLowerCase();
    return (
      job.id.toLowerCase().includes(search) ||
      job.name.toLowerCase().includes(search)
    );
  });

  // Ensure selected index is valid
  useEffect(() => {
    if (selectedIndex >= filteredJobs.length) {
      setSelectedIndex(Math.max(0, filteredJobs.length - 1));
    }
  }, [filteredJobs.length, selectedIndex]);

  // Handle keyboard input
  useInput((input, key) => {
    if (showFilter) {
      if (key.return) {
        setShowFilter(false);
      } else if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setFilter((f) => f + input);
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(filteredJobs.length - 1, i + 1));
    } else if (key.return) {
      const job = filteredJobs[selectedIndex];
      if (job) onSelect(job);
    } else if (input === 'r') {
      // Run job
      const job = filteredJobs[selectedIndex];
      if (job && !running) {
        handleRunJob(job);
      }
    } else if (input === ' ') {
      // Toggle enabled
      const job = filteredJobs[selectedIndex];
      if (job) {
        handleToggleJob(job);
      }
    } else if (input === 'd') {
      // Delete job
      const job = filteredJobs[selectedIndex];
      if (job) {
        handleDeleteJob(job);
      }
    } else if (input === 'a') {
      onAdd();
    } else if (input === '/') {
      setShowFilter(true);
      setFilter('');
    }
  });

  const handleRunJob = async (job: Job) => {
    setRunning(job.id);
    try {
      const result = await runJob(config, job, { detach: true });
      if (result.success) {
        onMessage(`Job "${job.name}" started`, 'success');
      } else {
        onMessage(`Failed to start job: ${result.output}`, 'error');
      }
    } catch (err) {
      onMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setRunning(null);
    }
  };

  const handleToggleJob = (job: Job) => {
    try {
      const updated = toggleJob(config, job.id);
      loadJobs();
      const status = updated.enabled ? 'enabled' : 'disabled';
      onMessage(`Job "${job.name}" ${status}`, 'success');
    } catch (err) {
      onMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  };

  const handleDeleteJob = (job: Job) => {
    try {
      removeJob(config, job.id);
      loadJobs();
      onMessage(`Job "${job.name}" deleted`, 'success');
    } catch (err) {
      onMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="magenta">Jobs</Text>
        <Text dimColor> ({filteredJobs.length} of {jobs.length})</Text>
      </Box>

      {/* Filter input */}
      {showFilter && (
        <Box marginTop={1}>
          <Text>Filter: </Text>
          <Text color="cyan">{filter}</Text>
          <Text dimColor>_</Text>
        </Box>
      )}

      {/* Job list */}
      <Box flexDirection="column" marginTop={1}>
        {filteredJobs.length === 0 ? (
          <Text dimColor>
            {jobs.length === 0 ? 'No jobs configured. Press [a] to add one.' : 'No jobs match filter.'}
          </Text>
        ) : (
          filteredJobs.map((job, index) => (
            <JobRow
              key={job.id}
              job={job}
              selected={index === selectedIndex}
              running={running === job.id}
            />
          ))
        )}
      </Box>

      {/* Shortcuts */}
      <Box marginTop={1}>
        <Text dimColor>
          [enter] View  [r] Run now  [space] Toggle  [d] Delete  [a] Add  [/] Filter  [esc] Back
        </Text>
      </Box>
    </Box>
  );
}

interface JobRowProps {
  job: Job;
  selected: boolean;
  running: boolean;
}

function JobRow({ job, selected, running }: JobRowProps) {
  const enabled = job.enabled !== false;
  const scheduleDesc = job.schedule.type === 'cron'
    ? job.schedule.cron
    : job.schedule.type === 'random-window'
    ? `~${job.schedule.start}-${job.schedule.end}`
    : 'one-time';

  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined} bold={selected}>
        {selected ? '▸ ' : '  '}
      </Text>
      <Text
        color={selected ? 'cyan' : undefined}
        dimColor={!enabled}
      >
        {job.id.padEnd(22)}
      </Text>
      <Text color={running ? 'yellow' : enabled ? 'green' : 'red'}>
        {running ? '◐' : enabled ? '●' : '○'}
      </Text>
      <Text> </Text>
      <Text dimColor={!enabled}>
        {(running ? 'running' : enabled ? 'enabled' : 'disabled').padEnd(10)}
      </Text>
      <Text dimColor>{scheduleDesc}</Text>
    </Box>
  );
}
