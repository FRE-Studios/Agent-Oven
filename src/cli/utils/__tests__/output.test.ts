import { formatDuration } from '../output.js';

describe('formatDuration', () => {
  it('formats 0 seconds', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats exactly 1 minute', () => {
    expect(formatDuration(60)).toBe('1m');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats exact minutes with no seconds', () => {
    expect(formatDuration(120)).toBe('2m');
  });

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
  });

  it('formats hours with no remaining minutes', () => {
    expect(formatDuration(7200)).toBe('2h');
  });

  it('formats large durations', () => {
    expect(formatDuration(86400)).toBe('24h');
  });

  it('formats hours with remaining minutes but no seconds shown', () => {
    // 1h 30m = 5400s, seconds within the hour are dropped
    expect(formatDuration(5400)).toBe('1h 30m');
  });
});
