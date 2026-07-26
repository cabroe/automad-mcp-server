import { AutomadMcpError } from './errors.js';
import { logger } from './logger.js';

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
  /** Per-request timeout in ms. 0 disables. Default 30000. */
  timeoutMs?: number;
}

export interface RequestOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  /** Per-request timeout in ms. Overrides client default. 0 disables. */
  timeoutMs?: number;
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
    private readonly opts: HttpClientOptions & { timeoutMs?: number },
    private readonly auth: AuthProvider,
    private readonly defaults: {
      maxRetries?: number;
      retryDelayMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body });
  }

  delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, opts);
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
    const buf = Buffer.from(file.base64, 'base64');
    const size = buf.byteLength;
    const fdata = new FormData();
    // CSRF is refreshed inside the request() retry loop (see below).
    fdata.set('__csrf__', await this.auth.getCsrfToken());
    if (file.url) fdata.set('url', file.url);
    fdata.set(
      'file',
      new File([new Blob([buf], { type: file.mimeType })], file.filename, { type: file.mimeType }),
    );
    fdata.set('dzuuid', cryptoRandomId());
    fdata.set('dzchunkindex', '0');
    fdata.set('dztotalchunkcount', '1');
    fdata.set('dzchunkbyteoffset', '0');
    fdata.set('dzchunksize', String(size));
    return this.request<T>('POST', path, {
      ...opts,
      body: fdata,
      skipCsrf: true,
      _isMultipart: true,
    });
  }

  private async request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    const maxRetries = opts?.maxRetries ?? this.defaults.maxRetries ?? 2;
    const retryDelay = opts?.retryDelayMs ?? this.defaults.retryDelayMs ?? 250;
    const timeoutMs = opts?.timeoutMs ?? this.opts.timeoutMs ?? this.defaults.timeoutMs ?? 30_000;
    const url = this.opts.baseUrl.replace(/\/$/, '') + path;
    const isMultipart = opts?._isMultipart === true;
    let attempt = 0;
    let forceReauth = false;
    let forceRescrape = false;
    let csrfRescrapes = 0;
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
          opts.body.set('__csrf__', csrf);
        } catch {
          /* fall through; error surfaces on next response */
        }
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(opts?.headers ?? {}),
      };
      if (cookie) headers['Cookie'] = cookie;

      let body: BodyInit | undefined;
      if (isMultipart) {
        body = opts?.body as BodyInit;
      } else if (opts?.body !== undefined) {
        const fdata = new FormData();
        if (csrf) fdata.set('__csrf__', csrf);
        fdata.set('__json__', JSON.stringify(opts.body));
        body = fdata;
      }

      logger.debug({ method, url, attempt }, 'HTTP request');
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      // Per-request timeout (AbortController). 0 disables. Default 30s, override via AUTOMAD_REQUEST_TIMEOUT_MS.
      if (timeoutMs > 0) {
        const ac = new AbortController();
        init.signal = ac.signal;
        setTimeout(() => ac.abort(), timeoutMs).unref();
      }
      const res = await fetch(url, init);

      // Detect v2's "session is dead" marker BEFORE the regular retry/error
      // handling. v2 returns 200 OK with `{data: {message: "No session"}}` when
      // the session cookie is invalid (server restart, manual logout, expired).
      // Without this we'd either treat it as success (returning a misleading
      // `{message: "No session"}` payload) or hammer the API with a stale CSRF.
      if (res.ok && attempt <= maxRetries) {
        const peek = await safeJson(res);
        const peekData =
          peek && typeof peek === 'object' ? (peek as { data?: unknown }).data : undefined;
        const peekMsg =
          peekData &&
          typeof peekData === 'object' &&
          typeof (peekData as { message?: unknown }).message === 'string'
            ? (peekData as { message: string }).message
            : undefined;
        if (peekMsg && /^No session$/i.test(peekMsg)) {
          logger.warn(
            { url, attempt },
            "session expired (v2 'No session' marker), forcing re-auth",
          );
          forceReauth = true;
          await sleep(retryDelay);
          continue;
        }
        // Not a session marker — surface it through the normal envelope path.
        // Reconstruct a Response-like object so unwrap can re-parse the body.
        // (safeJson consumes the stream; we re-stringify to avoid a second read.)
        const rebuilt = new Response(JSON.stringify(peek), {
          status: res.status,
          headers: res.headers,
        });
        return unwrap<T>(rebuilt as Response, method, path);
      }

      if (res.status === 403 && attempt <= maxRetries) {
        const detail = await safeJson(res);
        const error =
          detail &&
          typeof detail === 'object' &&
          'error' in detail &&
          typeof detail.error === 'string'
            ? detail.error
            : '';
        if (/csrf/i.test(error)) {
          // If we've already rescraped the CSRF once and still get 403+CSRF,
          // the session itself is dead (e.g. server restart, long idle, manual
          // logout). Rescraping the CSRF with a dead session cannot recover —
          // we must force a re-auth so the next attempt carries a fresh session.
          if (csrfRescrapes >= 1) {
            logger.warn(
              { url, csrfRescrapes },
              'CSRF mismatch persists after rescrape — session likely dead, forcing re-auth',
            );
            forceReauth = true;
            csrfRescrapes = 0;
          } else {
            logger.warn({ url }, 'CSRF mismatch, rescrape + retry');
            forceRescrape = true;
            csrfRescrapes++;
          }
          await new Promise<void>((r) => setTimeout(r, retryDelay));
          continue;
        }
      }

      if (res.status === 401 && attempt <= maxRetries) {
        logger.warn({ url }, '401 received, retrying after re-auth');
        forceReauth = true;
        await sleep(retryDelay);
        continue;
      }

      // 5xx retry: only once, and only if status changes (otherwise we're hammering a broken endpoint).
      if (res.status >= 500 && attempt <= maxRetries && lastStatus !== res.status) {
        logger.warn({ url, status: res.status, attempt }, '5xx, retrying');
        lastStatus = res.status;
        await sleep(retryDelay * attempt);
        continue;
      }

      // We've exhausted retries. If the last response was 401, 403+CSRF, or
      // v2's friendly "No session" marker (200 OK + body) after we already
      // tried to force a re-auth, the credentials are dead — surface this as
      // AUTH so the caller can react (bad creds, user disabled, rotated
      // password) instead of a confusing 403/FORBIDDEN or a misleading
      // `{message: "No session"}` success payload.
      if (attempt > maxRetries) {
        let authFailed = false;
        if (res.status === 401) authFailed = true;
        else if (res.status === 403 && csrfRescrapes >= 1) authFailed = true;
        else if (res.ok) {
          const body = await safeJson(res).catch(() => undefined);
          const data =
            body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
          const msg =
            data &&
            typeof data === 'object' &&
            typeof (data as { message?: unknown }).message === 'string'
              ? (data as { message: string }).message
              : undefined;
          if (msg && /^No session$/i.test(msg)) authFailed = true;
        }
        if (authFailed) {
          throw new AutomadMcpError(
            'AUTH',
            `Authentication failed after re-auth attempt: HTTP ${res.status}`,
            { status: res.status },
          );
        }
      }

      return unwrap<T>(res, method, path);
    }
  }
}

/**
 * v2 has a known quirk: it returns 200 OK with `{code: 200, error: "..."}` for
 * server-side validation failures (e.g. missing required field, type mismatch).
 * Without this helper those surface as `UNKNOWN`, hiding that the issue is a
 * validation problem the caller can correct.
 *
 * The patterns below are derived from the real v2 message catalog in
 * `/app/automad/lang/english.json` (live-verified on `automad/automad:v2`).
 * Each entry is a specific signal that a user could correct the request for.
 * We deliberately do NOT match generic "Invalid ..." / "Error ..." / "Failed ..."
 * messages because those are used for non-validation failures (auth, network,
 * upstream, etc.) and misclassifying them would mislead callers.
 */
export function looksLikeServerValidation(errorText: string): boolean {
  if (errorText.length < 3 || errorText.length > 500) return false;
  for (const pattern of VALIDATION_PATTERNS) {
    if (pattern.test(errorText)) return true;
  }
  return false;
}

const VALIDATION_PATTERNS: readonly RegExp[] = [
  // "<Field> is required" / "<Field> missing" / "<Field> invalid" / "<Field> not found"
  // / "<Field> cannot ..." / "<Field> too ..." / "<Field> empty" / "<Field> whitespace"
  /^(?:title|page|url|name|filename|tag|path|field|email|username|password|image|file|target|search\s*value|replace\s*value)\b.{0,40}(?:required|missing|invalid|not found|cannot|too |empty|whitespace)/i,
  // Specific known v2 validation strings
  /^Title missing!$/i,
  /^Page not found!$/i,
  /^Name is required\.?$/i,
  /^Title required!$/i,
  /^Field required!$/i,
  /^Url required!$/i,
  /^Url invalid!$/i,
  /^Title missing!$/i,
  // "Please enter a valid <something>"
  /^Please enter (?:a valid |twice the same )/i,
  // "Please select a ..."
  /^Please select /i,
  /^Invalid (?:field|email|form|image|input|argument|value|page|file|tag|title|url)\b/i,
  // "Incomplete or incorrect data" / form-validation banner
  /^Incomplete or incorrect data/i,
  // "A username must ..." (v2 username rule)
  /^A username must /i,
  // "All fields are required ..."
  /^All fields are required/i,
  // Unsupported file type
  /^Unsupported file type "/i,
  // "Not implemented!" — caller asked for something v2 doesn't support yet
  /^Not implemented!?$/i,
  // Required (form-field shorthand)
  /^Required$/i,
];
/** Decode a v2 /_api JSON envelope: return `data` on success, throw on error. */
async function unwrap<T>(res: Response, method: string, path: string): Promise<T> {
  const payload = (await safeJson(res)) as Record<string, unknown> | undefined;

  const errorText =
    payload && typeof payload === 'object' && typeof payload.error === 'string'
      ? payload.error
      : undefined;
  const codeNum =
    payload && typeof payload === 'object' && typeof payload.code === 'number'
      ? payload.code
      : undefined;

  const isErrorResponse =
    !res.ok || (errorText && errorText.length > 0) || (codeNum !== undefined && codeNum >= 400);
  if (isErrorResponse) {
    const message = errorText ?? `HTTP ${res.status} on ${method} ${path}`;
    // v2 has a known quirk: it returns 200 OK with `{code: 200, error: "..."}`
    // for server-side validation failures. Detect that pattern and surface as
    // VALIDATION rather than UNKNOWN so callers can correct the request.
    let code: AutomadMcpError['code'] = mapStatusToCode(res.status);
    if (res.ok && errorText && looksLikeServerValidation(errorText)) {
      code = 'VALIDATION';
    }
    throw new AutomadMcpError(code, message, payload);
  }
  if (payload && 'data' in payload) {
    return payload.data as T;
  }
  return (payload ?? {}) as T;
}

function mapStatusToCode(status: number): AutomadMcpError['code'] {
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 404 || status === 410) return 'NOT_FOUND';
  if (status === 422 || status === 400) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 409) return 'CONFLICT';
  if (status >= 500) return 'NETWORK';
  return 'UNKNOWN';
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
