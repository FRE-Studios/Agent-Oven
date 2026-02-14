/**
 * Shared CLI output formatting utilities
 */

import chalk from 'chalk';

export function success(msg: string): void {
  console.log(chalk.green(`✓ ${msg}`));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(`⚠ ${msg}`));
}

export function info(msg: string): void {
  console.log(chalk.blue(`ℹ ${msg}`));
}

export function error(msg: string): void {
  console.error(chalk.red(`✗ ${msg}`));
}

export function statusIcon(ok: boolean): string {
  return ok ? chalk.green('✓') : chalk.red('✗');
}

/**
 * Print a simple padded table to stdout
 */
export function printTable(headers: string[], rows: string[][]): void {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? '').length))
  );

  // Header
  const headerLine = headers
    .map((h, i) => chalk.bold(h.padEnd(colWidths[i])))
    .join('  ');
  console.log(headerLine);
  console.log(colWidths.map((w) => '─'.repeat(w)).join('──'));

  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell ?? '').padEnd(colWidths[i])).join('  ');
    console.log(line);
  }
}

/**
 * Format seconds into a human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
