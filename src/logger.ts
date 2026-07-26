import pino from 'pino';
import { VALID_LOG_LEVELS } from './config.js';

const rawLevel = process.env.LOG_LEVEL ?? 'info';
if (!(rawLevel in VALID_LOG_LEVELS)) {
  // Fail loudly before pino() — otherwise pino's "defaultLevelNotFound"
  // assertion throws an opaque stack trace before loadConfig() can produce
  // the user-friendly VALIDATION error the codebase clearly intends.
  throw new Error(
    `Invalid LOG_LEVEL: ${rawLevel}. Must be one of: ${Object.keys(VALID_LOG_LEVELS).join(', ')}`,
  );
}

export const logger = pino(
  {
    level: rawLevel,
    redact: {
      paths: ['password', 'token', '*.password', '*.token', 'headers.authorization'],
      censor: '[REDACTED]',
    },
    base: {
      service: 'automad-mcp',
    },
  },
  process.stderr,
);
