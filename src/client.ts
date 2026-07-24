import { AutomadMcpError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * v2 /_api envelope shape (live-verified on 2.0.0-beta.15):
 *   success: { code: 200, data: <payload>, error: "", success: "" }
 *   failure: { code: 4xx/5xx, error: "<msg>", exception?: {...} }
 * Public reads return `data` directly; some endpoints return no `data` wrapper.
 */

export interface AuthProvider {
  getCookie(force?: boolean): Promise<string | undefined>;
  getCsrfToken(force?: boolean): Promise<string>;
}

export interface HttpClientOptions {
  baseUrl: string;
}

export interface RequestOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  /** POST body. Sent as `__json__` multipart field (JSON.stringify). Omit for reads. */
  body?: unknown;
  /** Skip CSRF injection (caller injected it manually, e.g. upload). */
  skipCsrf?: boolean;
  /** Internal: tells the request loop that `body` is already a FormData — don't wrap it. */
  _isMultipart?: boolean;
}

export class HttpClient {
  constructor(
    private readonly opts: HttpClientOptions,
    private readonly auth: AuthProvider,
    private readonly defaults: { maxRetries?: number; retryDelayMs?: number } = {},
  ) {}

  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, opts);
  }

  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }

  delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  /**
   * Single-chunk file upload via `/_api/file-collection/upload` (Dropzone contract).
   * v2 requires chunking metadata but a single-chunk payload (dztotalchunkcount=1) is valid.
   *
   * Note: this endpoint does NOT use the `__json__` wrapper — the upload path
   * skips `RequestHandler::convertJsonPost` (RequestHandler.php:145), so any
   * `__json__` field will be ignored. The destination URL is sent as a plain
   * `url` form field.
   */
  async upload<T>(
    path: string,
    file: { base64: string; filename: string; mimeType: string; url?: string },
    opts?: RequestOptions,
  ): Promise<T> {
    const buf = Buffer.from(file.base64, "base64");
    const size = buf.byteLength;
    const fdata = new FormData();
    // CSRF is refreshed inside the request() retry loop (see below).
    fdata.set("__csrf__", await this.auth.getCsrfToken());
    if (file.url) fdata.set("url", file.url);
    fdata.set(
      "file",
      new File([new Blob([buf], { type: file.mimeType })], file.filename, { type: file.mimeType }),
    );
    fdata.set("dzuuid", cryptoRandomId());
    fdata.set("dzchunkindex", "0");
    fdata.set("dztotalchunkcount", "1");
    fdata.set("dzchunkbyteoffset", "0");
    fdata.set("dzchunksize", String(size));
    return this.request<T>("POST", path, {
      ...opts,
      body: fdata,
      skipCsrf: true,
      _isMultipart: true,
    });
  }

  private async request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    const maxRetries = opts?.maxRetries ?? this.defaults.maxRetries ?? 2;
    const retryDelay = opts?.retryDelayMs ?? this.defaults.retryDelayMs ?? 250;
    const url = this.opts.baseUrl.replace(/\/$/, "") + path;
    const isMultipart = opts?._isMultipart === true;

    let attempt = 0;
    let forceReauth = false;
    let forceRescrape = false;
    let lastStatus: number | undefined;

    while (true) {
      attempt++;
      const cookie = await this.auth.getCookie(forceReauth);
      forceReauth = false;
      // For multipart bodies, csrf is already set in the FormData (upload()).
      // On rescrape, refresh it in place so the next attempt carries the new token.
      let csrf = opts?.skipCsrf ? undefined : await this.auth.getCsrfToken(forceRescrape);
      forceRescrape = false;
      if (opts?.skipCsrf && isMultipart && opts?.body instanceof FormData && attempt > 1) {
        try {
          csrf = await this.auth.getCsrfToken(true);
          opts.body.set("__csrf__", csrf);
        } catch { /* fall through; error surfaces on next response */ }
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
      };
      if (cookie) headers["Cookie"] = cookie;

      let body: BodyInit | undefined;
      if (isMultipart) {
        body = opts?.body as BodyInit;
      } else if (opts?.body !== undefined) {
        const fdata = new FormData();
        if (csrf) fdata.set("__csrf__", csrf);
        fdata.set("__json__", JSON.stringify(opts.body));
        body = fdata;
      }

      logger.debug({ method, url, attempt }, "HTTP request");
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      const res = await fetch(url, init);

      if (res.status === 403 && attempt <= maxRetries) {
        const detail = await safeJson(res);
        const error = (detail && typeof detail === "object" && "error" in detail && typeof detail.error === "string") ? detail.error : "";
        if (/csrf/i.test(error)) {
          logger.warn({ url }, "CSRF mismatch, rescrape + retry");
          forceRescrape = true;
          await new Promise<void>((r) => setTimeout(r, retryDelay));
          continue;
        }
      }

      if (res.status === 401 && attempt <= maxRetries) {
        logger.warn({ url }, "401 received, retrying after re-auth");
        forceReauth = true;
        await sleep(retryDelay);
        continue;
      }

      // 5xx retry: only once, and only if status changes (otherwise we're hammering a broken endpoint).
      if (res.status >= 500 && attempt <= maxRetries && lastStatus !== res.status) {
        logger.warn({ url, status: res.status, attempt }, "5xx, retrying");
        lastStatus = res.status;
        await sleep(retryDelay * attempt);
        continue;
      }

      return unwrap<T>(res, method, path);
    }
  }
}

/** Decode a v2 /_api JSON envelope: return `data` on success, throw on error. */
async function unwrap<T>(res: Response, method: string, path: string): Promise<T> {
  const payload = (await safeJson(res)) as Record<string, unknown> | undefined;

  const errorText =
    payload && typeof payload === "object" && typeof payload.error === "string"
      ? payload.error
      : undefined;
  const codeNum = payload && typeof payload === "object" && typeof payload.code === "number" ? payload.code : undefined;

  if (!res.ok || (errorText && errorText.length > 0) || (codeNum !== undefined && codeNum >= 400)) {
    const message = errorText ?? `HTTP ${res.status} on ${method} ${path}`;
    throw new AutomadMcpError(mapStatusToCode(res.status), message, payload);
  }

  if (payload && "data" in payload) {
    return payload.data as T;
  }
  return (payload ?? {}) as T;
}

function mapStatusToCode(status: number): AutomadMcpError["code"] {
  if (status === 401 || status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 422 || status === 400) return "VALIDATION";
  if (status === 429) return "RATE_LIMITED";
  if (status === 409) return "CONFLICT";
  if (status >= 500) return "NETWORK";
  return "UNKNOWN";
}

export async function safeJson(
  res: Response | { json: () => Promise<unknown>; text: () => Promise<string> },
): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return undefined;
    }
  }
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
