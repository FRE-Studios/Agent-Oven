/**
 * TUI-specific types
 */

import type { Job } from '../core/types.js';

/** Available screens in the TUI */
export type Screen =
  | { type: 'dashboard' }
  | { type: 'jobs' }
  | { type: 'job-form'; job?: Job }
  | { type: 'job-detail'; jobId: string }
  | { type: 'logs'; jobId?: string; logFile?: string };
