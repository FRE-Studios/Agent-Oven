/**
 * Simple readline-based prompts for CLI confirmation
 */

import * as readline from 'node:readline';

/**
 * Ask for y/N confirmation. Returns true if user confirms.
 */
export function confirm(message: string, defaultNo = true): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const hint = defaultNo ? '[y/N]' : '[Y/n]';
    rl.question(`${message} ${hint} `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(!defaultNo);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}
