import { AutomadMcpError } from "./errors.js";

export type WriteMode = "read-only" | "confirm-destructive" | "unrestricted";

export interface Config {
  url: string;
  username: string;
  password: string;
  writeMode: WriteMode;
  logLevel: string;
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

  const writeModeRaw = process.env.AUTOMAD_WRITE_MODE ?? "confirm-destructive";
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
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AutomadMcpError("VALIDATION", `Missing required environment variable: ${name}`);
  }
  return value;
}
