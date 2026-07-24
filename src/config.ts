import { AutomadMcpError } from "./errors.js";

export type WriteMode = "read-only" | "confirm-destructive" | "unrestricted";

export interface Config {
  url: string;
  username: string;
  password?: string;
  token?: string;
  writeMode: WriteMode;
  logLevel: string;
}

const VALID_MODES: ReadonlySet<WriteMode> = new Set([
  "read-only",
  "confirm-destructive",
  "unrestricted",
]);

export function loadConfig(): Config {
  const url = required("AUTOMAD_URL");
  const username = required("AUTOMAD_USER");
  const password = process.env.AUTOMAD_PASS;
  const token = process.env.AUTOMAD_TOKEN;

  if (!password && !token) {
    throw new AutomadMcpError(
      "VALIDATION",
      "Either AUTOMAD_PASS or AUTOMAD_TOKEN must be provided",
    );
  }

  const writeModeRaw = process.env.AUTOMAD_WRITE_MODE ?? "confirm-destructive";
  if (!VALID_MODES.has(writeModeRaw as WriteMode)) {
    throw new AutomadMcpError(
      "VALIDATION",
      `Invalid write mode in AUTOMAD_WRITE_MODE: ${writeModeRaw}. Must be one of: ${[...VALID_MODES].join(", ")}`,
    );
  }

  const config: Config = {
    url,
    username,
    writeMode: writeModeRaw as WriteMode,
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
  if (password !== undefined) config.password = password;
  if (token !== undefined) config.token = token;
  return config;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AutomadMcpError(
      "VALIDATION",
      `Missing required environment variable: ${name}`,
    );
  }
  return value;
}
