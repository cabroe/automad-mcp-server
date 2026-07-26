import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the Automad theme starter kit bundled with this package.
 *
 * The full starter kit (automadcms/automad-theme-starter-kit) ships inside the
 * npm package under `templates/starter-kit/` and is declared in package.json's
 * `files`. Resolving it relative to this module means `theme.scaffold` works out
 * of the box with no `AUTOMAD_STARTER_KIT_PATH` and no external clone.
 *
 * Layout at runtime: `dist/theme/starter-kit.js` → package root is `../../`, so
 * `../../templates/starter-kit`. During `tsx` dev the same relative walk from
 * `src/theme/starter-kit.ts` resolves to the same location.
 */
export const BUNDLED_STARTER_KIT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
  'starter-kit',
);
