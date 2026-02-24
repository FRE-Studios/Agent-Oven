import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Config, Job, DockerJob, Schedule } from '../../core/types.js';
import { addJob, updateJob, validateJob, getBuiltInImages } from '../../core/jobs.js';
import { describeCron, validateCron, validateRandomWindow } from '../../core/scheduler.js';
import type { RandomWindowSchedule } from '../../core/types.js';

interface JobFormProps {
  config: Config;
  existingJob?: Job;
  onSave: (job: Job) => void;
  onCancel: () => void;
}

type Field = 'id' | 'name' | 'image' | 'command' | 'scheduleType' | 'cron' | 'datetime' | 'rwStart' | 'rwEnd' | 'rwDays' | 'volumes' | 'timeout';

const FIELDS: Field[] = ['id', 'name', 'image', 'command', 'scheduleType', 'cron', 'datetime', 'rwStart', 'rwEnd', 'rwDays', 'volumes', 'timeout'];

export function JobForm({ config, existingJob, onSave, onCancel }: JobFormProps) {
  const isEdit = !!existingJob;
  // Form only supports Docker jobs; cast for field access
  const existingDocker = existingJob?.type === 'docker' ? existingJob : undefined;

  // Form state
  const [id, setId] = useState(existingJob?.id ?? '');
  const [name, setName] = useState(existingJob?.name ?? '');
  const [image, setImage] = useState(existingDocker?.image ?? 'agent-oven/python-tasks');
  const [command, setCommand] = useState(
    Array.isArray(existingDocker?.command)
      ? existingDocker.command.join(' ')
      : existingDocker?.command ?? ''
  );
  const [scheduleType, setScheduleType] = useState<'cron' | 'once' | 'random-window'>(
    existingJob?.schedule.type ?? 'cron'
  );
  const [cron, setCron] = useState(
    existingJob?.schedule.type === 'cron' ? existingJob.schedule.cron : '0 * * * *'
  );
  const [datetime, setDatetime] = useState(
    existingJob?.schedule.type === 'once' ? existingJob.schedule.datetime : ''
  );
  const [rwStart, setRwStart] = useState(
    existingJob?.schedule.type === 'random-window' ? existingJob.schedule.start : '09:00'
  );
  const [rwEnd, setRwEnd] = useState(
    existingJob?.schedule.type === 'random-window' ? existingJob.schedule.end : '10:00'
  );
  const [rwDays, setRwDays] = useState(
    existingJob?.schedule.type === 'random-window' ? (existingJob.schedule.days ?? '*') : '*'
  );
  const [volumes, setVolumes] = useState(existingDocker?.volumes?.join('\n') ?? '');
  const [timeout, setTimeout] = useState(existingDocker?.timeout?.toString() ?? '300');

  // UI state
  const [activeField, setActiveField] = useState<Field>(isEdit ? 'name' : 'id');
  const [error, setError] = useState<string | null>(null);
  const [imageSelectMode, setImageSelectMode] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);

  const builtInImages = getBuiltInImages();

  // Navigate fields
  const shouldSkipField = useCallback((field: Field): boolean => {
    if (field === 'cron' && scheduleType !== 'cron') return true;
    if (field === 'datetime' && scheduleType !== 'once') return true;
    if ((field === 'rwStart' || field === 'rwEnd' || field === 'rwDays') && scheduleType !== 'random-window') return true;
    return false;
  }, [scheduleType]);

  const nextField = useCallback(() => {
    const currentIndex = FIELDS.indexOf(activeField);
    let next = currentIndex + 1;

    while (next < FIELDS.length) {
      if (shouldSkipField(FIELDS[next])) {
        next++;
      } else {
        break;
      }
    }

    if (next < FIELDS.length) {
      setActiveField(FIELDS[next]);
    }
  }, [activeField, shouldSkipField]);

  const prevField = useCallback(() => {
    const currentIndex = FIELDS.indexOf(activeField);
    let prev = currentIndex - 1;

    while (prev >= 0) {
      if (shouldSkipField(FIELDS[prev])) {
        prev--;
      } else {
        break;
      }
    }

    if (prev >= 0) {
      setActiveField(FIELDS[prev]);
    }
  }, [activeField, shouldSkipField]);

  // Handle save
  const handleSave = useCallback(() => {
    setError(null);

    // Build schedule
    let schedule: Schedule;
    if (scheduleType === 'cron') {
      schedule = { type: 'cron', cron };
    } else if (scheduleType === 'random-window') {
      const rwSchedule: RandomWindowSchedule = { type: 'random-window', start: rwStart, end: rwEnd };
      if (rwDays && rwDays !== '*') rwSchedule.days = rwDays;
      const rwErr = validateRandomWindow(rwSchedule);
      if (rwErr) {
        setError(rwErr);
        return;
      }
      schedule = rwSchedule;
    } else {
      schedule = { type: 'once', datetime };
    }

    // Parse command
    const cmdParts = command.trim().split(/\s+/);

    // Build job object (form creates Docker jobs only)
    const jobData: Partial<DockerJob> = {
      type: 'docker',
      id,
      name,
      image,
      command: cmdParts.length > 1 ? cmdParts : command,
      schedule,
      volumes: volumes.trim() ? volumes.trim().split('\n').filter(Boolean) : undefined,
      timeout: timeout ? parseInt(timeout, 10) : undefined,
      enabled: existingJob?.enabled ?? true,
    };

    // Validate
    const errors = validateJob(jobData);
    if (scheduleType === 'cron') {
      const cronError = validateCron(cron);
      if (cronError) errors.push(`Cron: ${cronError}`);
    }

    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }

    try {
      let savedJob: Job;
      if (isEdit) {
        savedJob = updateJob(config, existingJob.id, {
          name: jobData.name,
          image: jobData.image,
          command: jobData.command,
          schedule: jobData.schedule,
          volumes: jobData.volumes,
          timeout: jobData.timeout,
        });
      } else {
        savedJob = addJob(config, jobData as Parameters<typeof addJob>[1]);
      }
      onSave(savedJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job');
    }
  }, [config, existingJob, isEdit, id, name, image, command, scheduleType, cron, datetime, rwStart, rwEnd, rwDays, volumes, timeout, onSave]);

  // Handle input
  useInput((input, key) => {
    if (key.ctrl && input === 's') {
      handleSave();
      return;
    }

    if (key.tab) {
      if (key.shift) {
        prevField();
      } else {
        nextField();
      }
      return;
    }

    // Image selection mode
    if (imageSelectMode) {
      if (key.upArrow) {
        setImageIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setImageIndex((i) => Math.min(builtInImages.length - 1, i + 1));
      } else if (key.return) {
        setImage(builtInImages[imageIndex]);
        setImageSelectMode(false);
        nextField();
      } else if (key.escape) {
        setImageSelectMode(false);
      }
      return;
    }

    // Schedule type toggle
    if (activeField === 'scheduleType') {
      if (key.leftArrow || key.rightArrow || input === ' ') {
        setScheduleType((t) => t === 'cron' ? 'random-window' : t === 'random-window' ? 'once' : 'cron');
      } else if (key.return) {
        nextField();
      }
      return;
    }

    // Image field - enter select mode
    if (activeField === 'image' && key.return) {
      setImageSelectMode(true);
      const idx = builtInImages.indexOf(image);
      setImageIndex(idx >= 0 ? idx : 0);
      return;
    }
  });

  // Get cron description
  const cronDesc = scheduleType === 'cron' && cron ? describeCron(cron) : '';
  const cronError = scheduleType === 'cron' && cron ? validateCron(cron) : null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="magenta">{isEdit ? 'Edit Job' : 'Add Job'}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {/* ID */}
        <FormField
          label="ID"
          active={activeField === 'id'}
          disabled={isEdit}
        >
          {isEdit ? (
            <Text dimColor>{id}</Text>
          ) : (
            <TextInput
              value={id}
              onChange={setId}
              focus={activeField === 'id'}
              placeholder="my-job-id"
            />
          )}
        </FormField>

        {/* Name */}
        <FormField label="Name" active={activeField === 'name'}>
          <TextInput
            value={name}
            onChange={setName}
            focus={activeField === 'name'}
            placeholder="Human-readable name"
          />
        </FormField>

        {/* Image */}
        <FormField label="Image" active={activeField === 'image'}>
          {imageSelectMode ? (
            <Box flexDirection="column">
              {builtInImages.map((img, i) => (
                <Text key={img} color={i === imageIndex ? 'cyan' : undefined}>
                  {i === imageIndex ? '▸ ' : '  '}{img}
                </Text>
              ))}
            </Box>
          ) : (
            <Box>
              <TextInput
                value={image}
                onChange={setImage}
                focus={activeField === 'image'}
                placeholder="docker-image"
              />
              <Text dimColor> (enter to select)</Text>
            </Box>
          )}
        </FormField>

        {/* Command */}
        <FormField label="Command" active={activeField === 'command'}>
          <TextInput
            value={command}
            onChange={setCommand}
            focus={activeField === 'command'}
            placeholder="python script.py"
          />
        </FormField>

        {/* Schedule Type */}
        <FormField label="Schedule" active={activeField === 'scheduleType'}>
          <Box>
            <Text color={scheduleType === 'cron' ? 'cyan' : undefined}>
              ({scheduleType === 'cron' ? '●' : '○'}) Cron
            </Text>
            <Text>  </Text>
            <Text color={scheduleType === 'random-window' ? 'cyan' : undefined}>
              ({scheduleType === 'random-window' ? '●' : '○'}) Random Window
            </Text>
            <Text>  </Text>
            <Text color={scheduleType === 'once' ? 'cyan' : undefined}>
              ({scheduleType === 'once' ? '●' : '○'}) One-time
            </Text>
          </Box>
        </FormField>

        {/* Cron Expression */}
        {scheduleType === 'cron' && (
          <FormField label="Cron" active={activeField === 'cron'}>
            <Box flexDirection="column">
              <TextInput
                value={cron}
                onChange={setCron}
                focus={activeField === 'cron'}
                placeholder="0 * * * *"
              />
              {cronError ? (
                <Text color="red">  {cronError}</Text>
              ) : cronDesc ? (
                <Text dimColor>  = {cronDesc}</Text>
              ) : null}
            </Box>
          </FormField>
        )}

        {/* Datetime */}
        {scheduleType === 'once' && (
          <FormField label="Datetime" active={activeField === 'datetime'}>
            <TextInput
              value={datetime}
              onChange={setDatetime}
              focus={activeField === 'datetime'}
              placeholder="2024-12-31T23:59:00"
            />
          </FormField>
        )}

        {/* Random Window fields */}
        {scheduleType === 'random-window' && (
          <>
            <FormField label="Start" active={activeField === 'rwStart'}>
              <TextInput
                value={rwStart}
                onChange={setRwStart}
                focus={activeField === 'rwStart'}
                placeholder="09:00"
              />
            </FormField>
            <FormField label="End" active={activeField === 'rwEnd'}>
              <TextInput
                value={rwEnd}
                onChange={setRwEnd}
                focus={activeField === 'rwEnd'}
                placeholder="10:00"
              />
            </FormField>
            <FormField label="Days" active={activeField === 'rwDays'}>
              <Box>
                <TextInput
                  value={rwDays}
                  onChange={setRwDays}
                  focus={activeField === 'rwDays'}
                  placeholder="*"
                />
                <Text dimColor> (cron weekday: * or 1-5)</Text>
              </Box>
            </FormField>
          </>
        )}

        {/* Volumes */}
        <FormField label="Volumes" active={activeField === 'volumes'}>
          <TextInput
            value={volumes}
            onChange={setVolumes}
            focus={activeField === 'volumes'}
            placeholder="/host/path:/container/path"
          />
        </FormField>

        {/* Timeout */}
        <FormField label="Timeout" active={activeField === 'timeout'}>
          <Box>
            <TextInput
              value={timeout}
              onChange={setTimeout}
              focus={activeField === 'timeout'}
              placeholder="300"
            />
            <Text dimColor> seconds</Text>
          </Box>
        </FormField>
      </Box>

      {/* Error */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Shortcuts */}
      <Box marginTop={1}>
        <Text dimColor>
          [tab] Next  [shift+tab] Prev  [ctrl+s] Save  [esc] Cancel
        </Text>
      </Box>
    </Box>
  );
}

interface FormFieldProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

function FormField({ label, active, disabled, children }: FormFieldProps) {
  return (
    <Box marginY={0}>
      <Text color={active ? 'cyan' : undefined} dimColor={disabled}>
        {label.padEnd(10)}
      </Text>
      <Box marginLeft={1}>
        {children}
      </Box>
    </Box>
  );
}
