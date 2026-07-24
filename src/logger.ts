import pino from "pino";

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["password", "token", "*.password", "*.token", "headers.authorization"],
      censor: "[REDACTED]",
    },
    base: {
      service: "automad-mcp",
    },
  },
  process.stderr
);
