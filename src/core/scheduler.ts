/**
 * Scheduler logic - cron parsing and schedule matching
 */

import type { Schedule, CronSchedule, OneTimeSchedule } from './types.js';

/**
 * Cron field names for error messages
 */
const CRON_FIELDS = ['minute', 'hour', 'day', 'month', 'weekday'] as const;

/**
 * Parse a cron field value and check if it matches the current value
 */
function matchesCronField(field: string, currentValue: number): boolean {
  // Wildcard matches anything
  if (field === '*') {
    return true;
  }

  // Step values (*/n)
  const stepMatch = field.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10);
    return currentValue % step === 0;
  }

  // Range with step (n-m/s)
  const rangeStepMatch = field.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStepMatch) {
    const start = parseInt(rangeStepMatch[1], 10);
    const end = parseInt(rangeStepMatch[2], 10);
    const step = parseInt(rangeStepMatch[3], 10);
    if (currentValue < start || currentValue > end) {
      return false;
    }
    return (currentValue - start) % step === 0;
  }

  // Range (n-m)
  const rangeMatch = field.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    return currentValue >= start && currentValue <= end;
  }

  // Comma-separated values
  if (field.includes(',')) {
    const values = field.split(',');
    return values.some((v) => matchesCronField(v.trim(), currentValue));
  }

  // Exact value
  const exactValue = parseInt(field, 10);
  if (!isNaN(exactValue)) {
    return currentValue === exactValue;
  }

  return false;
}

/**
 * Check if a weekday cron field matches, treating both 0 and 7 as Sunday.
 * Standard cron: 0=Sunday, 1=Monday, ..., 6=Saturday, 7=Sunday.
 * JS getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday.
 */
function matchesWeekdayField(field: string, currentWeekday: number): boolean {
  if (field === '*') {
    return true;
  }

  // Check if the field matches the current weekday directly
  if (matchesCronField(field, currentWeekday)) {
    return true;
  }

  // If today is Sunday (0), also check against 7
  if (currentWeekday === 0 && matchesCronField(field, 7)) {
    return true;
  }

  // If the field contains 7 and today is Sunday (0), already handled above.
  // If the field contains 0 and today is Sunday, already handled by direct match.
  return false;
}

/**
 * Check if a cron expression matches the current time
 */
export function cronMatches(cronExpr: string, date: Date = new Date()): boolean {
  const parts = cronExpr.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minute, hour, day, month, weekday] = parts;

  // Get current time components
  const currentMinute = date.getMinutes();
  const currentHour = date.getHours();
  const currentDay = date.getDate();
  const currentMonth = date.getMonth() + 1; // JavaScript months are 0-indexed
  const currentWeekday = date.getDay(); // 0=Sunday, 6=Saturday

  return (
    matchesCronField(minute, currentMinute) &&
    matchesCronField(hour, currentHour) &&
    matchesCronField(day, currentDay) &&
    matchesCronField(month, currentMonth) &&
    matchesWeekdayField(weekday, currentWeekday)
  );
}

/**
 * Check if a one-time schedule should run
 */
export function onceShouldRun(datetime: string, lastRun: string | null | undefined): boolean {
  // Already run
  if (lastRun) {
    return false;
  }

  const targetTime = new Date(datetime).getTime();
  const now = Date.now();

  return now >= targetTime;
}

/**
 * Check if a schedule should run now
 */
export function shouldRunNow(schedule: Schedule, lastRun?: string | null): boolean {
  if (schedule.type === 'cron') {
    return cronMatches(schedule.cron);
  } else if (schedule.type === 'once') {
    return onceShouldRun(schedule.datetime, lastRun);
  }
  return false;
}

/**
 * Parse a cron expression and return human-readable description
 */
export function describeCron(cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/);

  if (parts.length !== 5) {
    return 'Invalid cron expression';
  }

  const [minute, hour, day, month, weekday] = parts;

  // Common patterns
  if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return 'Every minute';
  }

  if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }

  if (hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    const interval = hour.slice(2);
    const minPart = minute === '0' ? '' : ` at minute ${minute}`;
    return `Every ${interval} hours${minPart}`;
  }

  if (minute !== '*' && hour !== '*' && day === '*' && month === '*' && weekday === '*') {
    return `Every day at ${padTime(hour)}:${padTime(minute)}`;
  }

  if (minute !== '*' && hour !== '*' && day === '*' && month === '*' && weekday !== '*') {
    const days = describeWeekday(weekday);
    return `${days} at ${padTime(hour)}:${padTime(minute)}`;
  }

  if (minute !== '*' && hour !== '*' && day !== '*' && month === '*' && weekday === '*') {
    return `Day ${day} of every month at ${padTime(hour)}:${padTime(minute)}`;
  }

  // Generic description
  const desc: string[] = [];

  if (minute !== '*') desc.push(`minute ${minute}`);
  if (hour !== '*') desc.push(`hour ${hour}`);
  if (day !== '*') desc.push(`day ${day}`);
  if (month !== '*') desc.push(`month ${month}`);
  if (weekday !== '*') desc.push(`weekday ${weekday}`);

  return desc.length > 0 ? `At ${desc.join(', ')}` : 'Every minute';
}

/**
 * Describe a weekday field
 */
function describeWeekday(field: string): string {
  // Support both 0=Sunday and 7=Sunday conventions
  const names: Record<number, string> = {
    0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
  };

  if (field.includes(',')) {
    const days = field.split(',').map((d) => names[parseInt(d, 10)] || d);
    return days.join(', ');
  }

  if (field.includes('-')) {
    const [start, end] = field.split('-').map((d) => parseInt(d, 10));
    return `${names[start] || start} to ${names[end] || end}`;
  }

  const day = parseInt(field, 10);
  if (day in names) {
    return `Every ${names[day]}`;
  }

  return `Weekday ${field}`;
}

/**
 * Pad time value to 2 digits
 */
function padTime(value: string): string {
  const num = parseInt(value, 10);
  return isNaN(num) ? value : num.toString().padStart(2, '0');
}

/**
 * Describe a one-time schedule
 */
export function describeOnce(datetime: string): string {
  const date = new Date(datetime);
  if (isNaN(date.getTime())) {
    return 'Invalid datetime';
  }

  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) {
    return `Scheduled for ${formatDateTime(date)} (past)`;
  }

  // Format relative time
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let relative: string;
  if (days > 0) {
    relative = `in ${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    relative = `in ${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    relative = `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    relative = 'shortly';
  }

  return `${formatDateTime(date)} (${relative})`;
}

/**
 * Format a date for display
 */
function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Describe any schedule type
 */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.type === 'cron') {
    return describeCron(schedule.cron);
  } else {
    return describeOnce(schedule.datetime);
  }
}

/**
 * Validate a cron expression
 */
export function validateCron(cronExpr: string): string | null {
  const parts = cronExpr.trim().split(/\s+/);

  if (parts.length !== 5) {
    return `Expected 5 fields, got ${parts.length}`;
  }

  const ranges = [
    { min: 0, max: 59 },  // minute
    { min: 0, max: 23 },  // hour
    { min: 1, max: 31 },  // day
    { min: 1, max: 12 },  // month
    { min: 0, max: 7 },   // weekday (0 and 7 are Sunday)
  ];

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const { min, max } = ranges[i];
    const error = validateCronField(field, min, max);
    if (error) {
      return `${CRON_FIELDS[i]}: ${error}`;
    }
  }

  return null;
}

/**
 * Validate a single cron field
 */
function validateCronField(field: string, min: number, max: number): string | null {
  if (field === '*') {
    return null;
  }

  // Handle comma-separated values
  if (field.includes(',')) {
    for (const part of field.split(',')) {
      const error = validateCronField(part.trim(), min, max);
      if (error) return error;
    }
    return null;
  }

  // Handle step values
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = parseInt(step, 10);
    if (isNaN(stepNum) || stepNum < 1) {
      return `Invalid step value: ${step}`;
    }
    if (range !== '*') {
      return validateCronField(range, min, max);
    }
    return null;
  }

  // Handle ranges
  if (field.includes('-')) {
    const [start, end] = field.split('-').map((s) => parseInt(s, 10));
    if (isNaN(start) || isNaN(end)) {
      return `Invalid range: ${field}`;
    }
    if (start < min || start > max) {
      return `Start value ${start} out of range (${min}-${max})`;
    }
    if (end < min || end > max) {
      return `End value ${end} out of range (${min}-${max})`;
    }
    if (start > end) {
      return `Start value ${start} greater than end ${end}`;
    }
    return null;
  }

  // Handle single value
  const value = parseInt(field, 10);
  if (isNaN(value)) {
    return `Invalid value: ${field}`;
  }
  if (value < min || value > max) {
    return `Value ${value} out of range (${min}-${max})`;
  }

  return null;
}

/**
 * Get next run time for a cron expression (approximate)
 */
export function getNextRun(schedule: Schedule): Date | null {
  if (schedule.type === 'once') {
    const date = new Date(schedule.datetime);
    return isNaN(date.getTime()) ? null : date;
  }

  // For cron, find the next matching minute
  const now = new Date();
  const check = new Date(now);
  check.setSeconds(0);
  check.setMilliseconds(0);

  // Check up to 1 week ahead
  for (let i = 0; i < 60 * 24 * 7; i++) {
    check.setMinutes(check.getMinutes() + 1);
    if (cronMatches(schedule.cron, check)) {
      return check;
    }
  }

  return null;
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const suffix = diff < 0 ? ' ago' : '';
  const prefix = diff >= 0 ? 'in ' : '';

  if (days > 0) {
    return `${prefix}${days} day${days > 1 ? 's' : ''}${suffix}`;
  }
  if (hours > 0) {
    return `${prefix}${hours} hour${hours > 1 ? 's' : ''}${suffix}`;
  }
  if (minutes > 0) {
    return `${prefix}${minutes} min${minutes > 1 ? 's' : ''}${suffix}`;
  }
  return diff >= 0 ? 'now' : 'just now';
}
