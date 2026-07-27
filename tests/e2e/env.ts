/**
 * Vitest setup file for the E2E suite: loads `.env.e2e` into `process.env`.
 *
 * `.env.e2e` is written by `npm run e2e:up` (scripts/testenv.ts) and holds the
 * URL + credentials of the throwaway Automad v2 instance. Loading it here means
 * `npm run e2e:run` needs no manual exports, while a variable already present
 * in the real environment always wins — so CI (which exports
 * `AUTOMAD_E2E_*` directly) is unaffected.
 *
 * Deliberately not a dotenv dependency: the format we write is a handful of
 * `KEY=value` lines and nothing more.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const ENV_FILE = resolve(ROOT, '.env.e2e');

if (existsSync(ENV_FILE)) {
  for (const rawLine of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
