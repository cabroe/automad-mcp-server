#!/usr/bin/env -S node --import tsx
/**
 * Local E2E test environment manager.
 *
 * Brings up a throwaway Automad v2 instance (docker-compose.e2e.yml), waits
 * until it answers, creates a *deterministic* dashboard admin (the image
 * otherwise generates a random user + password on first boot), and writes
 * `.env.e2e` with everything the MCP server and the E2E suite need.
 *
 * Every subcommand is idempotent: `up` on a running, healthy stack just
 * re-verifies the login and rewrites `.env.e2e`.
 *
 *   npm run e2e:up        # start + wait + ensure admin + write .env.e2e
 *   npm run e2e:status    # container state + HTTP probe + login probe
 *   npm run e2e:logs      # container logs (tail)
 *   npm run e2e:serve     # run the MCP server in full mode against the stack
 *   npm run e2e:down      # docker compose down -v + remove .env.e2e
 *
 * Configuration (all optional, defaults shown):
 *   AUTOMAD_E2E_PORT=8899           host port the instance binds to
 *   AUTOMAD_E2E_USER=mcpadmin       dashboard admin username
 *   AUTOMAD_E2E_PASS=mcp-e2e-secret dashboard admin password
 *   AUTOMAD_E2E_EMAIL=mcp-e2e@example.invalid
 *   AUTOMAD_E2E_TIMEOUT_MS=180000   how long `up` waits for the instance
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const COMPOSE_FILE = resolve(ROOT, "docker-compose.e2e.yml");
const ENV_FILE = resolve(ROOT, ".env.e2e");
const SERVICE = "automad";

const PORT = process.env.AUTOMAD_E2E_PORT ?? "8899";
const USER = process.env.AUTOMAD_E2E_USER ?? "mcpadmin";
const PASS = process.env.AUTOMAD_E2E_PASS ?? "mcp-e2e-secret";
const EMAIL = process.env.AUTOMAD_E2E_EMAIL ?? "mcp-e2e@example.invalid";
const URL = `http://localhost:${PORT}`;
const TIMEOUT_MS = Number.parseInt(process.env.AUTOMAD_E2E_TIMEOUT_MS ?? "180000", 10);

const READY_POLL_MS = 2000;

/* eslint-disable no-console -- this is a CLI script; console *is* the output */

function log(message: string): void {
  console.log(`e2e-env: ${message}`);
}

function fail(message: string): never {
  console.error(`e2e-env: ${message}`);
  process.exit(1);
}

/** `docker compose -f docker-compose.e2e.yml <args>`, inheriting stdio. */
function compose(args: string[], opts: { quiet?: boolean } = {}): void {
  const result = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    cwd: ROOT,
    stdio: opts.quiet ? "pipe" : "inherit",
    env: { ...process.env, AUTOMAD_E2E_PORT: PORT },
  });
  if (result.status !== 0) {
    fail(`docker compose ${args.join(" ")} failed (exit ${String(result.status)})`);
  }
}

/** Same, but captures stdout instead of inheriting it. */
function composeOutput(args: string[]): string {
  const result = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, AUTOMAD_E2E_PORT: PORT },
  });
  return result.stdout ?? "";
}

function assertDocker(): void {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("Docker does not appear to be running (`docker version` failed). Start Docker and retry.");
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * True once nginx + PHP-FPM answer. `session/validate` is served to anonymous
 * callers, so a 200 means "v2 is up", not "we are logged in".
 */
async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/_api/session/validate`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Probe the dashboard login. v2 answers a *failed* login with HTTP 200 and an
 * `error` key in the body, so the status code alone proves nothing.
 */
async function canLogIn(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/_api/session/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ "name-or-email": USER, password: PASS }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status !== 200) return false;
    const body = (await res.json()) as { error?: string };
    return body.error === undefined;
  } catch {
    return false;
  }
}

async function waitUntilReachable(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  log(`waiting for ${URL} (timeout ${String(Math.round(TIMEOUT_MS / 1000))}s) …`);
  while (Date.now() < deadline) {
    if (await isReachable()) {
      log("instance is reachable");
      return;
    }
    await sleep(READY_POLL_MS);
  }
  console.error(composeOutput(["logs", "--tail", "40", SERVICE]));
  fail(`instance did not become reachable within ${String(TIMEOUT_MS)}ms`);
}

/**
 * Create the deterministic admin unless it already works. `user:create` is
 * additive — v2 has no "user exists" check and would happily create a second
 * account — so the login probe guards it and keeps `up` idempotent.
 */
async function ensureAdmin(): Promise<void> {
  if (await canLogIn()) {
    log(`admin "${USER}" already usable`);
    return;
  }
  log(`creating dashboard admin "${USER}" …`);
  compose(
    [
      "exec",
      "-T",
      SERVICE,
      "php",
      "/app/automad/console",
      "user:create",
      "--username",
      USER,
      "--password",
      PASS,
      "--email",
      EMAIL,
    ],
    { quiet: true },
  );
  // The account is written to disk synchronously, but a cold PHP-FPM can need
  // a beat before the accounts file is picked up by the next request.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await canLogIn()) {
      log(`admin "${USER}" created`);
      return;
    }
    await sleep(1000);
  }
  fail(`created admin "${USER}" but the login still fails — see \`npm run e2e:logs\``);
}

function writeEnvFile(): void {
  const contents = [
    "# Generated by scripts/testenv.ts — do not edit, do not commit.",
    "# Consumed automatically by the E2E suite (tests/e2e/env.ts).",
    "#",
    "# For an interactive MCP server against this instance:",
    "#   set -a && source .env.e2e && set +a && npm run dev",
    "",
    "# Opt-in switch for tests/e2e/** — without these the suite skips itself.",
    `AUTOMAD_E2E_URL=${URL}`,
    `AUTOMAD_E2E_USER=${USER}`,
    `AUTOMAD_E2E_PASS=${PASS}`,
    "",
    "# The same values under the names the server itself reads.",
    "AUTOMAD_MODE=full",
    `AUTOMAD_URL=${URL}`,
    `AUTOMAD_USER=${USER}`,
    `AUTOMAD_PASS=${PASS}`,
    "AUTOMAD_WRITE_MODE=confirm-destructive",
    "LOG_LEVEL=info",
    "",
  ].join("\n");
  writeFileSync(ENV_FILE, contents, "utf8");
  log(`wrote ${ENV_FILE}`);
}

async function up(): Promise<void> {
  assertDocker();
  log(`starting Automad v2 on ${URL} …`);
  compose(["up", "-d"]);
  await waitUntilReachable();
  await ensureAdmin();
  writeEnvFile();
  console.log(
    [
      "",
      "  Automad v2 test instance ready",
      `    dashboard : ${URL}/dashboard`,
      `    user      : ${USER}`,
      `    password  : ${PASS}`,
      "",
      "  Run the E2E suite:   npm run e2e:run",
      "  Tear everything down: npm run e2e:down",
      "",
    ].join("\n"),
  );
}

function down(): void {
  assertDocker();
  log("removing containers and volumes …");
  compose(["down", "-v"]);
  if (existsSync(ENV_FILE)) {
    rmSync(ENV_FILE);
    log(`removed ${ENV_FILE}`);
  }
  log("environment destroyed");
}

async function status(): Promise<void> {
  assertDocker();
  const ps = composeOutput(["ps", "--format", "{{.Name}}\t{{.State}}\t{{.Status}}"]).trim();
  console.log(ps === "" ? "e2e-env: no containers (run `npm run e2e:up`)" : ps);
  const reachable = await isReachable();
  console.log(`e2e-env: ${URL} reachable: ${String(reachable)}`);
  if (reachable) {
    console.log(`e2e-env: login as "${USER}": ${String(await canLogIn())}`);
  }
  console.log(`e2e-env: ${ENV_FILE} present: ${String(existsSync(ENV_FILE))}`);
  if (!reachable) process.exit(1);
}

function logs(): void {
  assertDocker();
  compose(["logs", "--tail", "80", SERVICE]);
}

/**
 * Run the MCP server in full mode against the test instance. stdio transport,
 * so this is for MCP Inspector / manual JSON-RPC pokes — the E2E suite spawns
 * its own server processes.
 */
async function serve(): Promise<void> {
  if (!(await isReachable())) {
    fail("test instance is not reachable — run `npm run e2e:up` first");
  }
  const entry = resolve(ROOT, "dist", "index.js");
  if (!existsSync(entry)) fail(`${entry} not found — run \`npm run build\` first`);
  log(`starting MCP server (full mode, stdio) against ${URL}`);
  execFileSync(process.execPath, [entry], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      AUTOMAD_MODE: "full",
      AUTOMAD_URL: URL,
      AUTOMAD_USER: USER,
      AUTOMAD_PASS: PASS,
      AUTOMAD_WRITE_MODE: process.env.AUTOMAD_WRITE_MODE ?? "confirm-destructive",
    },
  });
}

const COMMANDS: Record<string, () => void | Promise<void>> = {
  up,
  down,
  status,
  logs,
  serve,
};

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  const run = COMMANDS[command];
  if (!run) {
    fail(`unknown command "${command}". Use one of: ${Object.keys(COMMANDS).join(", ")}`);
  }
  await run();
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
