export type AutomadErrorCode =
  | 'AUTH'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'BUILD'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export class AutomadMcpError extends Error {
  constructor(
    public readonly code: AutomadErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AutomadMcpError';
  }
}

export interface SerializedError {
  code: AutomadErrorCode;
  message: string;
  details?: unknown;
}

export function errorToJson(err: unknown): SerializedError {
  if (err instanceof AutomadMcpError) {
    const out: SerializedError = { code: err.code, message: err.message };
    if (err.details !== undefined) out.details = err.details;
    return out;
  }
  if (err instanceof Error) {
    return { code: 'UNKNOWN', message: err.message };
  }
  return { code: 'UNKNOWN', message: String(err) };
}
