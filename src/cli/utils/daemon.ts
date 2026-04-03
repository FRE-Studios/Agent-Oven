import { platform } from '../../core/platform.js';
import { success, warn } from './output.js';

export function warnIfDaemonConfigStale(): boolean {
  const diagnostic = platform.validateDaemonConfig();
  if (!diagnostic) {
    return false;
  }

  warn(diagnostic);
  return true;
}

export async function repairStaleDaemonConfig(): Promise<boolean> {
  const diagnostic = platform.validateDaemonConfig();
  if (!diagnostic) {
    return false;
  }

  warn(diagnostic);

  const projectDir = platform.getDaemonProjectDir();
  if (!projectDir) {
    throw new Error(
      `Unable to determine the project directory from daemon config at ${platform.getDaemonConfigPath()}. ` +
      'Run `agent-oven init` from the intended project directory to regenerate it.',
    );
  }

  const result = await platform.installDaemon(projectDir);
  if (!result.success) {
    throw new Error(`Failed to regenerate daemon config: ${result.error}`);
  }

  success(`Daemon config regenerated with current Node path for ${projectDir}.`);
  return true;
}
