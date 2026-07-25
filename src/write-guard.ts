import { randomUUID } from "node:crypto";
import type { Config, WriteMode } from "./config.js";

export type WriteAction =
  | "pages.list"
  | "pages.get"
  | "pages.create"
  | "pages.update"
  | "pages.delete"
  | "pages.move"
  | "pages.duplicate"
  | "media.list"
  | "media.upload"
  | "shared.get"
  | "shared.set"
  | "config.get"
  | "config.set"
  | "site.info"
  | "site.search"
  | "theme.list"
  | "theme.install"
  | "theme.activate"
  | "theme.uninstall"
  | "theme.scaffold"
  | "theme.build"
  | "theme.read"
  | "theme.write"
  | "theme.files"
  | "theme.analyze"
  | "theme.validate"
  | "theme.schema"
  | "theme.diff"
  | "theme.generate"
  | "pages.publish"
  | "pages.batch_update"
  | "site.health"
  | "docs.list"
  | "docs.search"
  | "docs.get";

export type Permit =
  | { allowed: true }
  | {
      allowed: "pending";
      confirmToken: string;
      target: string;
      action: WriteAction;
      expiresAt: string;
    }
  | { allowed: false; reason: string };

const READ_ACTIONS: ReadonlySet<WriteAction> = new Set<WriteAction>([
  "pages.list",
  "pages.get",
  "media.list",
  "shared.get",
  "config.get",
  "site.info",
  "site.search",
  "theme.list",
  "theme.read",
  "theme.files",
  "theme.analyze",
  "theme.validate",
  "theme.schema",
  "theme.diff",
  "theme.generate",
  "site.health",
  "docs.list",
  "docs.search",
  "docs.get",
]);

const DESTRUCTIVE_ACTIONS: ReadonlySet<WriteAction> = new Set<WriteAction>([
  "pages.delete",
  "pages.move",
  "theme.install",
  "theme.activate",
  "theme.uninstall",
  "theme.scaffold",
  "theme.build",
  "theme.write",
]);

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
    if (this.mode === "read-only") {
      return { allowed: false, reason: "Server is in read-only mode" };
    }
    if (this.mode === "unrestricted") {
      return { allowed: true };
    }

    if (confirmToken !== undefined) {
      const entry = this.pending.get(confirmToken);
      if (!entry || entry.expiresAt < Date.now() || entry.action !== action || entry.target !== target) {
        return { allowed: false, reason: "expired or unknown" };
      }
      this.pending.delete(confirmToken);
      return { allowed: true };
    }
    if (!DESTRUCTIVE_ACTIONS.has(action)) {
      return { allowed: true };
    }

    const token = randomUUID();
    const expiresAt = Date.now() + this.ttlMs;
    this.pending.set(token, { token, action, target, expiresAt });
    return {
      allowed: "pending",
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
      return { allowed: false, reason: entry ? "expired" : "unknown token" };
    }
    this.pending.delete(token);
    return { allowed: true };
  }

  clear(): void {
    this.pending.clear();
  }
}
