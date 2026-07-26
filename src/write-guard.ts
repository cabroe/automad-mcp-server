import { randomUUID } from 'node:crypto';
import type { Config, WriteMode } from './config.js';
import { actionsWhere, type WriteAction } from './capabilities/registry.js';

/** Re-exported for convenience: the union itself is derived from the capability registry. */
export type { WriteAction };

export type Permit =
  | { allowed: true }
  | {
      allowed: 'pending';
      confirmToken: string;
      target: string;
      action: WriteAction;
      expiresAt: string;
    }
  | { allowed: false; reason: string };
/**
 * Read-only actions — allowed in every write mode. Derived from the capability
 * registry (`readOnly: true`), so the guard can never disagree with what
 * `automad_discover` advertises.
 */
export const READ_ACTIONS: ReadonlySet<WriteAction> = actionsWhere((action) => action.readOnly);

/**
 * Destructive actions — require a confirm token in `confirm-destructive` mode
 * (the default). Derived from the registry (`destructive: true`), including the
 * internal, guard-only actions (`pages.update_rename`, `site.search_replace`).
 */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<WriteAction> = actionsWhere(
  (action) => action.destructive,
);

export interface WriteGuardOptions {
  ttlMs?: number;
}

interface PendingEntry {
  token: string;
  action: WriteAction;
  target: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class WriteGuard {
  private readonly mode: WriteMode;
  private readonly ttlMs: number;
  private readonly pending = new Map<string, PendingEntry>();

  constructor(cfg: Config, opts: WriteGuardOptions = {}) {
    this.mode = cfg.writeMode;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  check(action: WriteAction, target: string, confirmToken?: string): Permit {
    if (READ_ACTIONS.has(action)) {
      return { allowed: true };
    }
    if (this.mode === 'read-only') {
      return { allowed: false, reason: 'Server is in read-only mode' };
    }
    if (this.mode === 'unrestricted') {
      return { allowed: true };
    }

    if (confirmToken !== undefined) {
      const entry = this.pending.get(confirmToken);
      if (!entry) {
        return { allowed: false, reason: 'unknown token' };
      }
      if (entry.expiresAt < Date.now()) {
        // Token was valid but expired; drop it so the caller doesn't keep
        // re-trying with a stale identifier.
        this.pending.delete(confirmToken);
        return { allowed: false, reason: 'expired token' };
      }
      if (entry.action !== action || entry.target !== target) {
        // Token is valid but was issued for a different (action, target) pair.
        return {
          allowed: false,
          reason: `token was issued for a different action or target (got action=${action}, target=${target})`,
        };
      }
      this.pending.delete(confirmToken);
      return { allowed: true };
    }
    if (!DESTRUCTIVE_ACTIONS.has(action)) {
      return { allowed: true };
    }

    if (this.pending.size > 50) {
      const now = Date.now();
      for (const [k, v] of this.pending.entries()) {
        if (v.expiresAt < now) this.pending.delete(k);
      }
    }
    const token = randomUUID();
    const expiresAt = Date.now() + this.ttlMs;
    this.pending.set(token, { token, action, target, expiresAt });
    return {
      allowed: 'pending',
      confirmToken: token,
      target,
      action,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  confirm(token: string): Permit {
    const entry = this.pending.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.pending.delete(token);
      return { allowed: false, reason: entry ? 'expired' : 'unknown token' };
    }
    this.pending.delete(token);
    return { allowed: true };
  }

  clear(): void {
    this.pending.clear();
  }
}
