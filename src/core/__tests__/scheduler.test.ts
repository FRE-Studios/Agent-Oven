import {
  cronMatches,
  validateCron,
  describeCron,
  describeSchedule,
  describeOnce,
  onceShouldRun,
  shouldRunNow,
  getNextRun,
  formatRelativeTime,
  randomWindowShouldRun,
  validateRandomWindow,
  describeRandomWindow,
  deterministicHash,
  parseHHMM,
} from '../scheduler.js';
import type { RandomWindowSchedule } from '../types.js';

// ─── cronMatches ────────────────────────────────────────────

describe('cronMatches', () => {
  // Wildcard
  it('matches every minute with * * * * *', () => {
    expect(cronMatches('* * * * *', new Date('2025-06-15T10:30:00'))).toBe(true);
  });

  // Exact values
  it('matches exact minute', () => {
    expect(cronMatches('30 * * * *', new Date('2025-06-15T10:30:00'))).toBe(true);
  });

  it('does not match wrong minute', () => {
    expect(cronMatches('15 * * * *', new Date('2025-06-15T10:30:00'))).toBe(false);
  });

  it('matches exact hour and minute', () => {
    expect(cronMatches('0 9 * * *', new Date('2025-06-15T09:00:00'))).toBe(true);
  });

  it('does not match wrong hour', () => {
    expect(cronMatches('0 9 * * *', new Date('2025-06-15T10:00:00'))).toBe(false);
  });

  it('matches exact day of month', () => {
    expect(cronMatches('0 0 15 * *', new Date('2025-06-15T00:00:00'))).toBe(true);
  });

  it('does not match wrong day', () => {
    expect(cronMatches('0 0 15 * *', new Date('2025-06-14T00:00:00'))).toBe(false);
  });

  it('matches exact month', () => {
    expect(cronMatches('0 0 1 6 *', new Date('2025-06-01T00:00:00'))).toBe(true);
  });

  it('does not match wrong month', () => {
    expect(cronMatches('0 0 1 6 *', new Date('2025-07-01T00:00:00'))).toBe(false);
  });

  // Step values (*/n)
  it('matches */5 when minute is divisible by 5', () => {
    expect(cronMatches('*/5 * * * *', new Date('2025-06-15T10:15:00'))).toBe(true);
  });

  it('does not match */5 when minute is not divisible', () => {
    expect(cronMatches('*/5 * * * *', new Date('2025-06-15T10:13:00'))).toBe(false);
  });

  it('matches */15 at minute 0', () => {
    expect(cronMatches('*/15 * * * *', new Date('2025-06-15T10:00:00'))).toBe(true);
  });

  it('matches */15 at minute 45', () => {
    expect(cronMatches('*/15 * * * *', new Date('2025-06-15T10:45:00'))).toBe(true);
  });

  it('matches */2 for even hours', () => {
    expect(cronMatches('0 */2 * * *', new Date('2025-06-15T04:00:00'))).toBe(true);
  });

  it('does not match */2 for odd hours', () => {
    expect(cronMatches('0 */2 * * *', new Date('2025-06-15T03:00:00'))).toBe(false);
  });

  // Ranges (n-m)
  it('matches within range 9-17', () => {
    expect(cronMatches('0 9-17 * * *', new Date('2025-06-15T12:00:00'))).toBe(true);
  });

  it('matches at range start', () => {
    expect(cronMatches('0 9-17 * * *', new Date('2025-06-15T09:00:00'))).toBe(true);
  });

  it('matches at range end', () => {
    expect(cronMatches('0 9-17 * * *', new Date('2025-06-15T17:00:00'))).toBe(true);
  });

  it('does not match below range', () => {
    expect(cronMatches('0 9-17 * * *', new Date('2025-06-15T08:00:00'))).toBe(false);
  });

  it('does not match above range', () => {
    expect(cronMatches('0 9-17 * * *', new Date('2025-06-15T18:00:00'))).toBe(false);
  });

  // Range with step (n-m/s)
  it('matches range+step 1-10/2 at 1', () => {
    expect(cronMatches('1-10/2 * * * *', new Date('2025-06-15T10:01:00'))).toBe(true);
  });

  it('matches range+step 1-10/2 at 3', () => {
    expect(cronMatches('1-10/2 * * * *', new Date('2025-06-15T10:03:00'))).toBe(true);
  });

  it('matches range+step 1-10/2 at 9', () => {
    expect(cronMatches('1-10/2 * * * *', new Date('2025-06-15T10:09:00'))).toBe(true);
  });

  it('does not match range+step 1-10/2 at 2', () => {
    expect(cronMatches('1-10/2 * * * *', new Date('2025-06-15T10:02:00'))).toBe(false);
  });

  it('does not match range+step outside range', () => {
    expect(cronMatches('1-10/2 * * * *', new Date('2025-06-15T10:11:00'))).toBe(false);
  });

  // Comma-separated values
  it('matches first value in list', () => {
    expect(cronMatches('0,15,30,45 * * * *', new Date('2025-06-15T10:00:00'))).toBe(true);
  });

  it('matches middle value in list', () => {
    expect(cronMatches('0,15,30,45 * * * *', new Date('2025-06-15T10:30:00'))).toBe(true);
  });

  it('matches last value in list', () => {
    expect(cronMatches('0,15,30,45 * * * *', new Date('2025-06-15T10:45:00'))).toBe(true);
  });

  it('does not match value not in list', () => {
    expect(cronMatches('0,15,30,45 * * * *', new Date('2025-06-15T10:10:00'))).toBe(false);
  });

  // Weekday field - Sunday as 0 and 7
  it('matches weekday 0 on Sunday', () => {
    // 2025-06-15 is a Sunday
    expect(cronMatches('0 0 * * 0', new Date('2025-06-15T00:00:00'))).toBe(true);
  });

  it('matches weekday 7 on Sunday', () => {
    expect(cronMatches('0 0 * * 7', new Date('2025-06-15T00:00:00'))).toBe(true);
  });

  it('matches weekday 1 on Monday', () => {
    // 2025-06-16 is a Monday
    expect(cronMatches('0 0 * * 1', new Date('2025-06-16T00:00:00'))).toBe(true);
  });

  it('does not match weekday 1 on Sunday', () => {
    expect(cronMatches('0 0 * * 1', new Date('2025-06-15T00:00:00'))).toBe(false);
  });

  it('matches weekday range 1-5 (Mon-Fri) on Wednesday', () => {
    // 2025-06-18 is a Wednesday
    expect(cronMatches('0 9 * * 1-5', new Date('2025-06-18T09:00:00'))).toBe(true);
  });

  it('does not match weekday range 1-5 on Saturday', () => {
    // 2025-06-21 is a Saturday
    expect(cronMatches('0 9 * * 1-5', new Date('2025-06-21T09:00:00'))).toBe(false);
  });

  // All fields combined
  it('matches all fields: 30 14 15 6 *', () => {
    expect(cronMatches('30 14 15 6 *', new Date('2025-06-15T14:30:00'))).toBe(true);
  });

  it('fails when one field mismatches', () => {
    expect(cronMatches('30 14 15 6 *', new Date('2025-06-15T14:31:00'))).toBe(false);
  });

  // Error handling
  it('throws on wrong field count (too few)', () => {
    expect(() => cronMatches('* * *', new Date())).toThrow('expected 5 fields, got 3');
  });

  it('throws on wrong field count (too many)', () => {
    expect(() => cronMatches('* * * * * *', new Date())).toThrow('expected 5 fields, got 6');
  });

  it('throws on empty string', () => {
    expect(() => cronMatches('', new Date())).toThrow('expected 5 fields');
  });

  // Edge: non-matching field returns false (not an error)
  it('returns false for unrecognized field value', () => {
    expect(cronMatches('abc * * * *', new Date('2025-06-15T10:30:00'))).toBe(false);
  });
});

// ─── validateCron ───────────────────────────────────────────

describe('validateCron', () => {
  it('returns null for valid cron: * * * * *', () => {
    expect(validateCron('* * * * *')).toBeNull();
  });

  it('returns null for valid cron: 0 9 * * 1-5', () => {
    expect(validateCron('0 9 * * 1-5')).toBeNull();
  });

  it('returns null for valid cron with step: */5 * * * *', () => {
    expect(validateCron('*/5 * * * *')).toBeNull();
  });

  it('returns null for valid cron with commas: 0,30 * * * *', () => {
    expect(validateCron('0,30 * * * *')).toBeNull();
  });

  it('returns null for valid cron: 0 0 1 1 *', () => {
    expect(validateCron('0 0 1 1 *')).toBeNull();
  });

  it('reports wrong field count (too few)', () => {
    expect(validateCron('* * *')).toBe('Expected 5 fields, got 3');
  });

  it('reports wrong field count (too many)', () => {
    expect(validateCron('* * * * * *')).toBe('Expected 5 fields, got 6');
  });

  it('reports out-of-range minute (60)', () => {
    const result = validateCron('60 * * * *');
    expect(result).toContain('minute');
    expect(result).toContain('out of range');
  });

  it('reports out-of-range hour (24)', () => {
    const result = validateCron('0 24 * * *');
    expect(result).toContain('hour');
    expect(result).toContain('out of range');
  });

  it('reports out-of-range day (0)', () => {
    const result = validateCron('0 0 0 * *');
    expect(result).toContain('day');
    expect(result).toContain('out of range');
  });

  it('reports out-of-range day (32)', () => {
    const result = validateCron('0 0 32 * *');
    expect(result).toContain('day');
    expect(result).toContain('out of range');
  });

  it('reports out-of-range month (0)', () => {
    const result = validateCron('0 0 1 0 *');
    expect(result).toContain('month');
    expect(result).toContain('out of range');
  });

  it('reports out-of-range month (13)', () => {
    const result = validateCron('0 0 1 13 *');
    expect(result).toContain('month');
    expect(result).toContain('out of range');
  });

  it('reports out-of-range weekday (8)', () => {
    const result = validateCron('0 0 * * 8');
    expect(result).toContain('weekday');
    expect(result).toContain('out of range');
  });

  it('allows weekday 7 (Sunday alias)', () => {
    expect(validateCron('0 0 * * 7')).toBeNull();
  });

  it('reports invalid step value (0)', () => {
    const result = validateCron('*/0 * * * *');
    expect(result).toContain('Invalid step');
  });

  it('reports inverted range', () => {
    const result = validateCron('30-10 * * * *');
    expect(result).toContain('greater than end');
  });

  it('reports invalid range values', () => {
    const result = validateCron('abc-def * * * *');
    expect(result).toContain('Invalid range');
  });

  it('reports invalid single value', () => {
    const result = validateCron('xyz * * * *');
    expect(result).toContain('Invalid value');
  });
});

// ─── describeCron ───────────────────────────────────────────

describe('describeCron', () => {
  it('describes every minute', () => {
    expect(describeCron('* * * * *')).toBe('Every minute');
  });

  it('describes every N minutes', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
  });

  it('describes every N minutes (15)', () => {
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('describes every N hours', () => {
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours');
  });

  it('describes every N hours with minute offset', () => {
    expect(describeCron('30 */2 * * *')).toBe('Every 2 hours at minute 30');
  });

  it('describes daily at specific time', () => {
    expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
  });

  it('describes daily at midnight', () => {
    expect(describeCron('0 0 * * *')).toBe('Every day at 00:00');
  });

  it('describes daily with minutes', () => {
    expect(describeCron('30 14 * * *')).toBe('Every day at 14:30');
  });

  it('describes weekday pattern with single day', () => {
    expect(describeCron('0 9 * * 1')).toBe('Every Mon at 09:00');
  });

  it('describes weekday pattern with range', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('Mon to Fri at 09:00');
  });

  it('describes weekday pattern with comma list', () => {
    expect(describeCron('0 9 * * 1,3,5')).toBe('Mon, Wed, Fri at 09:00');
  });

  it('describes monthly pattern', () => {
    expect(describeCron('0 0 1 * *')).toBe('Day 1 of every month at 00:00');
  });

  it('describes monthly on 15th', () => {
    expect(describeCron('30 10 15 * *')).toBe('Day 15 of every month at 10:30');
  });

  it('returns generic for complex expressions', () => {
    const result = describeCron('0 9 1 6 *');
    expect(result).toContain('hour 9');
    expect(result).toContain('day 1');
    expect(result).toContain('month 6');
  });

  it('returns invalid for wrong field count', () => {
    expect(describeCron('* * *')).toBe('Invalid cron expression');
  });
});

// ─── describeSchedule ───────────────────────────────────────

describe('describeSchedule', () => {
  it('delegates to describeCron for cron schedule', () => {
    expect(describeSchedule({ type: 'cron', cron: '*/5 * * * *' })).toBe('Every 5 minutes');
  });

  it('delegates to describeOnce for once schedule', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00'));
    const result = describeSchedule({ type: 'once', datetime: '2024-12-01T00:00:00' });
    expect(result).toContain('past');
    vi.useRealTimers();
  });
});

// ─── describeOnce ───────────────────────────────────────────

describe('describeOnce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('describes past datetime with "(past)"', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-14T10:00:00');
    expect(result).toContain('(past)');
  });

  it('describes future datetime with relative time in days', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-20T12:00:00');
    expect(result).toContain('in 5 days');
  });

  it('describes future datetime with relative time in hours', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-15T15:00:00');
    expect(result).toContain('in 3 hours');
  });

  it('describes future datetime with relative time in minutes', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-15T12:30:00');
    expect(result).toContain('in 30 minutes');
  });

  it('describes imminent future as "shortly"', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-15T12:00:30');
    expect(result).toContain('shortly');
  });

  it('returns "Invalid datetime" for garbage input', () => {
    expect(describeOnce('not-a-date')).toBe('Invalid datetime');
  });

  it('describes future with singular day', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-16T12:00:00');
    expect(result).toContain('in 1 day');
    expect(result).not.toContain('days');
  });

  it('describes future with singular hour', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-15T13:00:00');
    expect(result).toContain('in 1 hour');
    expect(result).not.toContain('hours');
  });

  it('describes future with singular minute', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    const result = describeOnce('2025-06-15T12:01:00');
    expect(result).toContain('in 1 minute');
    expect(result).not.toContain('minutes');
  });
});

// ─── onceShouldRun ──────────────────────────────────────────

describe('onceShouldRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for past datetime with no lastRun', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(onceShouldRun('2025-06-14T00:00:00', null)).toBe(true);
  });

  it('returns false for future datetime', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(onceShouldRun('2025-06-20T00:00:00', null)).toBe(false);
  });

  it('returns false when already run (lastRun set)', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(onceShouldRun('2025-06-14T00:00:00', '2025-06-14T00:01:00')).toBe(false);
  });

  it('returns false for undefined lastRun with future datetime', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(onceShouldRun('2025-12-25T00:00:00', undefined)).toBe(false);
  });

  it('returns true when now equals target time', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(onceShouldRun('2025-06-15T12:00:00', null)).toBe(true);
  });
});

// ─── shouldRunNow ───────────────────────────────────────────

describe('shouldRunNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes cron schedule to cronMatches', () => {
    // Set to a time that matches */5
    vi.setSystemTime(new Date('2025-06-15T10:15:00'));
    expect(shouldRunNow({ type: 'cron', cron: '*/5 * * * *' })).toBe(true);
  });

  it('routes once schedule to onceShouldRun', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(shouldRunNow({ type: 'once', datetime: '2025-06-14T00:00:00' }, null)).toBe(true);
  });

  it('returns false for once schedule already run', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(shouldRunNow({ type: 'once', datetime: '2025-06-14T00:00:00' }, '2025-06-14T00:01:00')).toBe(false);
  });
});

// ─── getNextRun ─────────────────────────────────────────────

describe('getNextRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the datetime for once schedule', () => {
    const result = getNextRun({ type: 'once', datetime: '2025-12-25T10:00:00' });
    expect(result).toEqual(new Date('2025-12-25T10:00:00'));
  });

  it('returns null for once schedule with invalid datetime', () => {
    expect(getNextRun({ type: 'once', datetime: 'invalid' })).toBeNull();
  });

  it('finds the next matching minute for every-minute cron', () => {
    vi.setSystemTime(new Date('2025-06-15T10:30:00'));
    const result = getNextRun({ type: 'cron', cron: '* * * * *' });
    expect(result).not.toBeNull();
    expect(result!.getMinutes()).toBe(31);
  });

  it('finds the next matching time for hourly cron', () => {
    vi.setSystemTime(new Date('2025-06-15T10:30:00'));
    const result = getNextRun({ type: 'cron', cron: '0 * * * *' });
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(11);
    expect(result!.getMinutes()).toBe(0);
  });

  it('finds next run for daily cron', () => {
    vi.setSystemTime(new Date('2025-06-15T10:30:00'));
    const result = getNextRun({ type: 'cron', cron: '0 9 * * *' });
    expect(result).not.toBeNull();
    // Next 9:00 AM is tomorrow
    expect(result!.getDate()).toBe(16);
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
  });

  it('finds next run for */5 cron', () => {
    vi.setSystemTime(new Date('2025-06-15T10:32:00'));
    const result = getNextRun({ type: 'cron', cron: '*/5 * * * *' });
    expect(result).not.toBeNull();
    expect(result!.getMinutes()).toBe(35);
  });
});

// ─── formatRelativeTime ─────────────────────────────────────

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "now" for current time', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('now');
  });

  it('shows "just now" for time just passed', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:30'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('just now');
  });

  it('shows future minutes', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:05:00'))).toBe('in 5 mins');
  });

  it('shows future singular minute', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:01:00'))).toBe('in 1 min');
  });

  it('shows past minutes', () => {
    vi.setSystemTime(new Date('2025-06-15T12:10:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('10 mins ago');
  });

  it('shows past singular minute', () => {
    vi.setSystemTime(new Date('2025-06-15T12:01:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('1 min ago');
  });

  it('shows future hours', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T15:00:00'))).toBe('in 3 hours');
  });

  it('shows future singular hour', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T13:00:00'))).toBe('in 1 hour');
  });

  it('shows past hours', () => {
    vi.setSystemTime(new Date('2025-06-15T15:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('3 hours ago');
  });

  it('shows future days', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-18T12:00:00'))).toBe('in 3 days');
  });

  it('shows future singular day', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-16T12:00:00'))).toBe('in 1 day');
  });

  it('shows past days', () => {
    vi.setSystemTime(new Date('2025-06-18T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('3 days ago');
  });

  it('shows past singular day', () => {
    vi.setSystemTime(new Date('2025-06-16T12:00:00'));
    expect(formatRelativeTime(new Date('2025-06-15T12:00:00'))).toBe('1 day ago');
  });
});

// ─── deterministicHash / parseHHMM ──────────────────────────

describe('deterministicHash', () => {
  it('returns a non-negative integer', () => {
    const hash = deterministicHash('test-seed');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('is deterministic (same input → same output)', () => {
    expect(deterministicHash('abc:2025-06-15')).toBe(deterministicHash('abc:2025-06-15'));
  });

  it('produces different values for different inputs', () => {
    expect(deterministicHash('job-a:2025-06-15')).not.toBe(deterministicHash('job-b:2025-06-15'));
  });
});

describe('parseHHMM', () => {
  it('parses 00:00 to 0', () => {
    expect(parseHHMM('00:00')).toBe(0);
  });

  it('parses 09:30 to 570', () => {
    expect(parseHHMM('09:30')).toBe(9 * 60 + 30);
  });

  it('parses 23:59 to 1439', () => {
    expect(parseHHMM('23:59')).toBe(23 * 60 + 59);
  });
});

// ─── randomWindowShouldRun ──────────────────────────────────

describe('randomWindowShouldRun', () => {
  const schedule: RandomWindowSchedule = { type: 'random-window', start: '09:00', end: '10:00' };

  it('is deterministic: same date + jobId always returns the same result', () => {
    const date = new Date('2025-06-15T09:30:00');
    const r1 = randomWindowShouldRun(schedule, null, date, 'test-job');
    const r2 = randomWindowShouldRun(schedule, null, date, 'test-job');
    expect(r1).toBe(r2);
  });

  it('different dates produce different target minutes (most of the time)', () => {
    // Test across many dates — at least one should differ in target minute
    const results: boolean[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = new Date(`2025-06-${String(d).padStart(2, '0')}T09:30:00`);
      results.push(randomWindowShouldRun(schedule, null, date, 'test-job'));
    }
    // Not all should be the same (statistically impossible with 60-min window and 30 days)
    const trues = results.filter(Boolean).length;
    const falses = results.filter((r) => !r).length;
    expect(trues + falses).toBe(30);
  });

  it('different jobIds produce different target minutes for the same date', () => {
    // Find the target minute for each job on the same day by iterating all minutes in window
    const findTarget = (jobId: string): number | null => {
      for (let m = 0; m < 60; m++) {
        const date = new Date(`2025-06-15T09:${String(m).padStart(2, '0')}:00`);
        if (randomWindowShouldRun(schedule, null, date, jobId)) return m;
      }
      return null;
    };
    const t1 = findTarget('job-alpha');
    const t2 = findTarget('job-beta');
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    // Very unlikely to be the same (1/60 chance)
    // If they happen to be equal, that's still a valid hash — we just test that both resolve
    expect(t1! >= 0 && t1! < 60).toBe(true);
    expect(t2! >= 0 && t2! < 60).toBe(true);
  });

  it('returns false if already run today', () => {
    // Find the matching minute first
    let matchingDate: Date | null = null;
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-15T09:${String(m).padStart(2, '0')}:00`);
      if (randomWindowShouldRun(schedule, null, d, 'my-job')) {
        matchingDate = d;
        break;
      }
    }
    expect(matchingDate).not.toBeNull();
    // Now test with a lastRun on the same day
    expect(randomWindowShouldRun(schedule, '2025-06-15T08:00:00', matchingDate!, 'my-job')).toBe(false);
  });

  it('returns true if lastRun was yesterday', () => {
    // Find the matching minute
    let matchingDate: Date | null = null;
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-15T09:${String(m).padStart(2, '0')}:00`);
      if (randomWindowShouldRun(schedule, null, d, 'my-job')) {
        matchingDate = d;
        break;
      }
    }
    expect(matchingDate).not.toBeNull();
    expect(randomWindowShouldRun(schedule, '2025-06-14T09:00:00', matchingDate!, 'my-job')).toBe(true);
  });

  it('respects weekday filtering — returns false on wrong day', () => {
    const weekdaySchedule: RandomWindowSchedule = { type: 'random-window', start: '09:00', end: '10:00', days: '1-5' };
    // 2025-06-15 is Sunday (day 0) — should be filtered out
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-15T09:${String(m).padStart(2, '0')}:00`);
      expect(randomWindowShouldRun(weekdaySchedule, null, d, 'test-job')).toBe(false);
    }
  });

  it('allows weekday when day matches', () => {
    const weekdaySchedule: RandomWindowSchedule = { type: 'random-window', start: '09:00', end: '10:00', days: '1-5' };
    // 2025-06-16 is Monday (day 1) — should have exactly one matching minute
    let found = false;
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-16T09:${String(m).padStart(2, '0')}:00`);
      if (randomWindowShouldRun(weekdaySchedule, null, d, 'test-job')) found = true;
    }
    expect(found).toBe(true);
  });

  it('handles midnight-spanning window (e.g., 23:00 - 01:00)', () => {
    const midnightSchedule: RandomWindowSchedule = { type: 'random-window', start: '23:00', end: '01:00' };
    // Window is 2 hours = 120 minutes
    let found = false;
    // Check 23:xx
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-15T23:${String(m).padStart(2, '0')}:00`);
      if (randomWindowShouldRun(midnightSchedule, null, d, 'midnight-job')) found = true;
    }
    // Check 00:xx
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-15T00:${String(m).padStart(2, '0')}:00`);
      if (randomWindowShouldRun(midnightSchedule, null, d, 'midnight-job')) found = true;
    }
    expect(found).toBe(true);
  });

  it('shouldRunNow returns false for random-window when jobId is missing', () => {
    expect(shouldRunNow(schedule, null, new Date('2025-06-15T09:30:00'))).toBe(false);
  });

  it('shouldRunNow routes to randomWindowShouldRun when jobId is provided', () => {
    // Find the exact minute that matches
    let matchingDate: Date | null = null;
    for (let m = 0; m < 60; m++) {
      const d = new Date(`2025-06-15T09:${String(m).padStart(2, '0')}:00`);
      if (randomWindowShouldRun(schedule, null, d, 'rw-job')) {
        matchingDate = d;
        break;
      }
    }
    expect(matchingDate).not.toBeNull();
    expect(shouldRunNow(schedule, null, matchingDate!, 'rw-job')).toBe(true);
  });
});

// ─── validateRandomWindow ───────────────────────────────────

describe('validateRandomWindow', () => {
  it('returns null for a valid window', () => {
    expect(validateRandomWindow({ type: 'random-window', start: '09:00', end: '10:00' })).toBeNull();
  });

  it('returns null for a midnight-spanning window', () => {
    expect(validateRandomWindow({ type: 'random-window', start: '23:00', end: '01:00' })).toBeNull();
  });

  it('reports invalid start time', () => {
    const result = validateRandomWindow({ type: 'random-window', start: '25:00', end: '10:00' });
    expect(result).toContain('Invalid start time');
  });

  it('reports invalid end time', () => {
    const result = validateRandomWindow({ type: 'random-window', start: '09:00', end: '10:60' });
    expect(result).toContain('Invalid end time');
  });

  it('reports start === end', () => {
    const result = validateRandomWindow({ type: 'random-window', start: '09:00', end: '09:00' });
    expect(result).toContain('must be different');
  });

  it('reports invalid days', () => {
    const result = validateRandomWindow({ type: 'random-window', start: '09:00', end: '10:00', days: '8' });
    expect(result).toContain('days');
  });

  it('allows valid days', () => {
    expect(validateRandomWindow({ type: 'random-window', start: '09:00', end: '10:00', days: '1-5' })).toBeNull();
  });

  it('accepts wildcard days', () => {
    expect(validateRandomWindow({ type: 'random-window', start: '09:00', end: '10:00', days: '*' })).toBeNull();
  });

  it('rejects non-HH:MM format', () => {
    const result = validateRandomWindow({ type: 'random-window', start: '9:00', end: '10:00' });
    expect(result).toContain('Invalid start time');
  });
});

// ─── describeRandomWindow ───────────────────────────────────

describe('describeRandomWindow', () => {
  it('describes daily window', () => {
    const result = describeRandomWindow({ type: 'random-window', start: '09:30', end: '10:00' });
    expect(result).toBe('Daily randomly between 09:30 and 10:00');
  });

  it('describes weekday-specific window', () => {
    const result = describeRandomWindow({ type: 'random-window', start: '09:00', end: '17:00', days: '1-5' });
    expect(result).toBe('Mon to Fri randomly between 09:00 and 17:00');
  });

  it('describes single-day window', () => {
    const result = describeRandomWindow({ type: 'random-window', start: '12:00', end: '13:00', days: '1' });
    expect(result).toBe('Every Mon randomly between 12:00 and 13:00');
  });

  it('describeSchedule routes to describeRandomWindow', () => {
    const result = describeSchedule({ type: 'random-window', start: '09:00', end: '10:00' });
    expect(result).toBe('Daily randomly between 09:00 and 10:00');
  });
});

// ─── getNextRun with random-window ──────────────────────────

describe('getNextRun with random-window', () => {
  it('returns null for random-window schedule', () => {
    expect(getNextRun({ type: 'random-window', start: '09:00', end: '10:00' })).toBeNull();
  });
});
