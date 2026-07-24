import { AutomadMcpError } from "./errors.js";
import { logger } from "./logger.js";

// Use global fetch (Node 18+ undici-backed) so consumers can stub it in tests
// via vi.stubGlobal("fetch", ...). The undici package is kept as a dependency
// to guarantee the runtime fetch is available on every supported Node version.

export interface AuthProvider {
  getCookie(): Promise<string | undefined>;
}

export interface HttpClientOptions {
  baseUrl: string;
}

export interface RequestOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export class HttpClient {
  constructor(
    private readonly opts: HttpClientOptions,
    private readonly auth: AuthProvider,
    private readonly defaults: { maxRetries?: number; retryDelayMs?: number } = {},
  ) {}

  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, opts);
  }

  async post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }

  async put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, { ...opts, body });
  }

  async delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  async uploadMultipart<T>(
    path: string,
    file: { base64: string; filename: string; mimeType: string },
    opts?: RequestOptions,
  ): Promise<T> {
    const boundary = `----automad-mcp-${Date.now()}`;
    const headerLine = `--${boundary}\r\n`;
    const fileLine = `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`;
    const fileBody = Buffer.from(file.base64, "base64");
    const closingLine = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(headerLine + fileLine),
      fileBody,
      Buffer.from(closingLine),
    ]);
    return this.request<T>("POST", path, {
      ...opts,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        ...(opts?.headers ?? {}),
      },
      body,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: RequestOptions,
  ): Promise<T> {
    const maxRetries = opts?.maxRetries ?? this.defaults.maxRetries ?? 2;
    const retryDelay = opts?.retryDelayMs ?? this.defaults.retryDelayMs ?? 250;
    const url = this.opts.baseUrl.replace(/\/$/, "") + path;

    let attempt = 0;
    while (true) {
      attempt++;
      const cookie = await this.auth.getCookie();
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
      };
      if (cookie) headers["Cookie"] = cookie;

      let body: BodyInit | undefined;
      if (opts?.body !== undefined) {
        if (typeof opts.body === "string" || Buffer.isBuffer(opts.body)) {
          body = opts.body as BodyInit;
        } else {
          headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
          body = JSON.stringify(opts.body);
        }
      }

      logger.debug({ method, url, attempt }, "HTTP request");
      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        init.body = body;
      }
      const res = await fetch(url, init);

      if (res.status === 401 && attempt <= maxRetries) {
        logger.warn({ url }, "401 received, retrying after re-auth");
        await sleep(retryDelay);
        continue;
      }

      if (res.status >= 500 && attempt <= maxRetries) {
        logger.warn({ url, status: res.status, attempt }, "5xx, retrying");
        await sleep(retryDelay * attempt);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        const code = res.status === 401 ? "AUTH" : "FORBIDDEN";
        throw new AutomadMcpError(code, `HTTP ${res.status} on ${method} ${path}`);
      }
      if (res.status === 404) {
        throw new AutomadMcpError("NOT_FOUND", `HTTP 404 on ${method} ${path}`);
      }
      if (res.status === 422 || res.status === 400) {
        const detail = await safeJson(res);
        throw new AutomadMcpError("VALIDATION", `HTTP ${res.status}`, detail);
      }
      if (res.status === 429) {
        throw new AutomadMcpError("RATE_LIMITED", "Rate limited by Automad dashboard");
      }
      if (!res.ok) {
        const detail = await safeJson(res);
        throw new AutomadMcpError("UNKNOWN", `HTTP ${res.status}`, detail);
      }

      return (await safeJson(res)) as T;
    }
  }
}

async function safeJson(res: Response | { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return JSON.parse(await res.text());
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
