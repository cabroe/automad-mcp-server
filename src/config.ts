import { AutomadMcpError } from "./errors.js";

export type WriteMode = "read-only" | "confirm-destructive" | "unrestricted";

export interface Config {
  url: string;
  username: string;
  password: string;
  writeMode: WriteMode;
  logLevel: string;
  /**
   * Absolute path on the local filesystem where Automad theme packages live.
   * Optional — when unset, the `automad_theme` tool returns a clear error
   * for every action and the rest of the server works fine.
   */
  themesPath?: string | undefined;
  /** Path to the starter-kit template used by `theme.scaffold`. */
  starterKitPath?: string | undefined;
}

/** Automad v2 only: JSON API base path. */
export const API_BASE = "/_api";

const VALID_MODES: Record<WriteMode, true> = {
  "read-only": true,
  "confirm-destructive": true,
  "unrestricted": true,
};

export function loadConfig(): Config {
  const url = required("AUTOMAD_URL");
  const username = required("AUTOMAD_USER");
  const password = required("AUTOMAD_PASS");
  const themesPath = process.env["AUTOMAD_THEMES_PATH"];
  const starterKitPath = process.env["AUTOMAD_STARTER_KIT_PATH"] ?? themesPath;

  const writeModeRaw = process.env["AUTOMAD_WRITE_MODE"] ?? "confirm-destructive";
  if (!(writeModeRaw in VALID_MODES)) {
    throw new AutomadMcpError(
      "VALIDATION",
      `Invalid write mode in AUTOMAD_WRITE_MODE: ${writeModeRaw}. Must be one of: ${Object.keys(VALID_MODES).join(", ")}`,
    );
  }

  return {
    url,
    username,
    password,
    writeMode: writeModeRaw as WriteMode,
    logLevel: process.env["LOG_LEVEL"] ?? "info",
    themesPath,
    starterKitPath,
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AutomadMcpError("VALIDATION", `Missing required environment variable: ${name}`);
  }
  return value;
}
