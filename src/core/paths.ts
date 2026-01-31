import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root of the agent-oven package (where package.json, images/, scheduler.sh live) */
export const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
