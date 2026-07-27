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

/**
 * Skipping is the right default locally — `npm test` must not need Docker. In
 * CI it is a trap: a broken `e2e:up` leaves no credentials, every file skips
 * itself, vitest exits 0, and the job reports success while nothing ran. That
 * happened, undetected, on the run that introduced the themes mount.
 *
 * So CI sets `AUTOMAD_E2E_REQUIRED=1` and this turns a silent skip into a
 * hard failure.
 */
if (process.env['AUTOMAD_E2E_REQUIRED'] === '1') {
  const missing = ['AUTOMAD_E2E_URL', 'AUTOMAD_E2E_USER', 'AUTOMAD_E2E_PASS'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(
      `AUTOMAD_E2E_REQUIRED=1 but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unset, ` +
        `so the live suite would silently skip itself. Either the environment failed to start ` +
        `(check \`npm run e2e:up\`) or ${ENV_FILE} was not written.`,
    );
  }
}
