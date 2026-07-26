#!/usr/bin/env -S node --import tsx
/**
 * End-to-end smoke test for the MCP server.
 *
 * Spawns `dist/index.js` over stdio, drives the JSON-RPC lifecycle, and
 * exercises a representative path through `automad_theme`:
 *   scaffold → dev → dev_status (poll until running) → dev_stop
 *
 * Unlike unit tests, this exercises the real HTTP/stdio plumbing, the
 * capability registry's binding loop, and the Live transport. It is not
 * a substitute for unit coverage — it catches the regressions that only
 * show up in a running process (handler registration, transport glue,
 * detached spawn).
 *
 * Configuration via env:
 *   AUTOMAD_MODE=docs (default — no live instance required)
 *   AUTOMAD_THEMES_PATH (required — where the theme lands)
 *   AUTOMAD_STARTER_KIT_PATH (required — what scaffold copies from)
 *   AUTOMAD_WRITE_MODE=unrestricted (default for the smoke run, so we
 *     don't have to dance the confirm-token flow)
 *   SMOKE_THEME_NAME (default: smoke-<timestamp>)
 *   SMOKE_PORT_HINT (optional — force a port via the new `port` field)
 *
 * Exits 0 on success, non-zero on any tool error or a timeout.
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const DIST = resolve(ROOT, "dist", "index.js");

const themesPath = process.env.AUTOMAD_THEMES_PATH;
const starterKitPath = process.env.AUTOMAD_STARTER_KIT_PATH;

if (!themesPath || !starterKitPath) {
  console.error(
    "smoke: AUTOMAD_THEMES_PATH and AUTOMAD_STARTER_KIT_PATH are required",
  );
  process.exit(2);
}
if (!existsSync(DIST)) {
  console.error(`smoke: ${DIST} not found — run \`npm run build\` first`);
  process.exit(2);
}

const themeName = process.env.SMOKE_THEME_NAME ?? `smoke-${Date.now()}`;

const env: NodeJS.ProcessEnv = {
  ...process.env,
  AUTOMAD_MODE: "docs",
  AUTOMAD_THEMES_PATH: themesPath,
  AUTOMAD_STARTER_KIT_PATH: starterKitPath,
  AUTOMAD_WRITE_MODE: process.env.AUTOMAD_WRITE_MODE ?? "unrestricted",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
};

const child: ChildProcess = spawn("node", [DIST], {
  cwd: ROOT,
  env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuf = "";
let nextId = 1;
const pending = new Map<number, (msg: JsonRpcResponse) => void>();
let exited = false;
let exitCode = 0;

function processFrames(): void {
  let idx: number;
  while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
    const frame = stdoutBuf.slice(0, idx);
    stdoutBuf = stdoutBuf.slice(idx + 1);
    if (!frame.trim()) continue;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(frame) as JsonRpcResponse;
    } catch {
      console.error("smoke: non-JSON frame:", frame);
      continue;
    }
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      const resolve = pending.get(msg.id)!;
      pending.delete(msg.id);
      resolve(msg);
    }
  }
}

child.stdout!.on("data", (chunk: Buffer) => {
  stdoutBuf += chunk.toString();
  processFrames();
});
child.stderr!.on("data", (chunk: Buffer) => {
  process.stderr.write(`smoke[server]: ${chunk.toString()}`);
});
child.on("exit", (code) => {
  exited = true;
  exitCode = code ?? 0;
});

function request(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const id = nextId++;
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => {
    pending.set(id, resolve);
  });
}

async function callTool(name: string, args: unknown): Promise<JsonRpcResponse> {
  const res = await request("tools/call", { name, arguments: args });
  if (res.error) throw new Error(`tool error: ${JSON.stringify(res.error)}`);
  if (res.result?.isError) {
    const text = (res.result.content?.[0] as { text?: string } | undefined)?.text ?? "";
    throw new Error(`tool reported isError: ${text}`);
  }
  return res;
}

function toolText(res: JsonRpcResponse): unknown {
  const block = res.result?.content?.[0] as { text?: string } | undefined;
  if (!block?.text) throw new Error("tool result has no text content");
  return JSON.parse(block.text);
}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  error?: { code: number; message: string };
}

const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 30_000;

async function pollUntilRunning(): Promise<{
  pid: number;
  port: number | null;
  url: string | null;
  running: boolean;
}> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited unexpectedly (code=${exitCode})`);
    const res = await callTool("automad_theme", { action: "dev_status", theme: themeName });
    const rec = toolText(res) as {
      pid: number;
      port: number | null;
      url: string | null;
      running: boolean;
    };
    if (rec.running) return rec;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`dev server did not start within ${POLL_TIMEOUT_MS}ms`);
}

function curlUrl(url: string): Promise<{ status: number; bodyBytes: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-sS", "-o", "/tmp/smoke-body.html", "-w", "%{http_code}", url],
      (err, stdout) => {
        if (err) return reject(err);
        const status = Number.parseInt(stdout.toString().trim(), 10);
        const bodyBytes = statSync("/tmp/smoke-body.html").size;
        resolve({ status, bodyBytes });
      },
    );
  });
}

async function main(): Promise<void> {
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.1" },
  });
  await request("notifications/initialized", {});

  console.log("smoke: scaffold…");
  await callTool("automad_theme", {
    action: "scaffold",
    name: themeName,
    description: "Smoke test theme",
  });

  console.log("smoke: dev…");
  const devArgs: Record<string, unknown> = { action: "dev", theme: themeName };
  if (process.env.SMOKE_PORT_HINT) {
    devArgs.port = Number.parseInt(process.env.SMOKE_PORT_HINT, 10);
  }
  await callTool("automad_theme", devArgs);

  console.log("smoke: poll until running…");
  const status = await pollUntilRunning();
  console.log(`smoke: dev running pid=${status.pid} port=${status.port} url=${status.url}`);

  if (status.url) {
    console.log(`smoke: curl ${status.url}…`);
    const { status: code, bodyBytes } = await curlUrl(status.url);
    console.log(`smoke: HTTP ${code}, ${bodyBytes} bytes`);
    if (code < 200 || code >= 400) {
      throw new Error(`curl returned HTTP ${code}`);
    }
  } else {
    console.log("smoke: no url discovered — skipping curl");
  }

  console.log("smoke: dev_stop…");
  const stop = await callTool("automad_theme", { action: "dev_stop", theme: themeName });
  const stopText = toolText(stop) as { stopped: boolean; signalUsed: string | null };
  if (!stopText.stopped) {
    throw new Error("dev_stop reported stopped=false");
  }
  console.log(`smoke: stopped (${stopText.signalUsed ?? "no signal"})`);

  console.log("smoke: OK");
}

function cleanup(): void {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
  try {
    rmSync(resolve(themesPath!, themeName), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error("smoke: FAILED:", err instanceof Error ? err.message : err);
    cleanup();
    process.exit(1);
  });
