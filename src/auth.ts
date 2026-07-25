import { AutomadMcpError } from "./errors.js";
import { logger } from "./logger.js";
import { safeJson } from "./client.js";
import { API_BASE, type Config } from "./config.js";

/** AuthProvider hands the HttpClient the session cookie and CSRF token. */
export interface AuthProvider {
  /** Returns `Cookie: name=value` or undefined. Forces re-login when true. */
  getCookie(force?: boolean): Promise<string | undefined>;
  /** Returns the current CSRF token, scraping a fresh one if needed. */
  getCsrfToken(force?: boolean): Promise<string>;
}

const CSRF_RE = /<meta\s+name="csrf"\s+content="([0-9a-f]{64})"/;

/** Cold-container login-probe resilience: a fresh v2 can 403 while the session/CSRF settle. */
const LOGIN_PROBE_ATTEMPTS = 3;
const LOGIN_PROBE_DELAY_MS = 200;

export class AuthManager implements AuthProvider {
  private cookie: string | undefined;
  private csrf: string | undefined;

  constructor(private readonly cfg: Config) {}

  async getCookie(force = false): Promise<string | undefined> {
    if (!force && this.cookie) return this.cookie;
    await this.login();
    return this.cookie;
  }

  async getCsrfToken(force = false): Promise<string> {
    if (!force && this.csrf) return this.csrf;
    try {
      await this.scrapeCsrf();
    } catch (e) {
      if (force) {
        logger.warn("CSRF scrape failed on forced refresh, forcing re-login");
        await this.login();
      } else {
        throw e;
      }
    }
    return this.csrf!;
  }

  private async login(): Promise<void> {
    const loginUrl = this.cfg.url.replace(/\/$/, "") + `${API_BASE}/session/login`;
    logger.info({ url: loginUrl, user: this.cfg.username }, "Logging into Automad v2 dashboard");

    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "name-or-email": this.cfg.username,
        password: this.cfg.password,
      }).toString(),
      redirect: "manual",
    });

    if (!res.ok) {
      throw new AutomadMcpError("AUTH", `Login failed: HTTP ${res.status}`, await safeJson(res));
    }

    // Cookie is set on the login response AND any redirect response.
    this.cookie = collectCookie([res.headers as HeaderLike | undefined ?? undefined]);
    if (!this.cookie) {
      throw new AutomadMcpError("AUTH", "No session cookie returned by Automad v2 login");
    }

    // A freshly started v2 (cold container) can 403 the probe while the session
    // and CSRF token settle. Re-scrape a fresh token + re-probe a few times
    // before giving up; genuine failures (bad creds / anonymous session) are
    // non-retryable and surface immediately.
    for (let attempt = 1; ; attempt++) {
      await this.scrapeCsrf();
      try {
        await this.probeAuthenticated();
        logger.info("Dashboard login successful");
        return;
      } catch (err) {
        const retryable = err instanceof AutomadMcpError && isRecord(err.details) && err.details["retryable"] === true;
        if (retryable && attempt < LOGIN_PROBE_ATTEMPTS) {
          logger.warn({ attempt }, "auth probe transient (cold session), retrying");
          await new Promise<void>((r) => setTimeout(r, LOGIN_PROBE_DELAY_MS * attempt));
          continue;
        }
        this.cookie = undefined;
        this.csrf = undefined;
        throw err;
      }
    }
  }

  /**
   * v2 has a dangerous quirk: the login endpoint returns 200 + a session
   * cookie for ANY credentials, but the session is unauthenticated when
   * the password is wrong. We probe by hitting /_api/app/bootstrap with the
   * cookie+CSRF and checking whether v2 returns the authenticated payload
   * (a populated `data.sitename`) or a generic error / empty body.
   */
  private async probeAuthenticated(): Promise<void> {
    const url = this.cfg.url.replace(/\/$/, "") + `${API_BASE}/app/bootstrap`;
    const csrf = this.csrf;
    if (!csrf) throw new AutomadMcpError("AUTH", "Cannot probe without CSRF token");
    const fdata = new FormData();
    fdata.set("__csrf__", csrf);
    fdata.set("__json__", "{}");
    const res = await fetch(url, {
      method: "POST",
      headers: { Cookie: this.cookie! },
      body: fdata,
    });
    if (!res.ok) {
      // 403 on a cold session/CSRF is transient (retryable); other statuses are not.
      // State is cleared by the caller (login) only after the final attempt.
      throw new AutomadMcpError("AUTH", `Login probe failed: HTTP ${res.status}`, { retryable: res.status === 403, status: res.status });
    }
    const body = (await safeJson(res)) as
      | { code?: number; data?: { sitename?: string }; error?: string }
      | undefined;
    // Bad credentials come back as {code: 200, error: "Invalid username or password."}.
    if (typeof body?.error === "string" && body.error.length > 0) {
      throw new AutomadMcpError("AUTH", `Login probe failed: ${body.error}`, { retryable: false });
    }
    // For a logged-in session, /app/bootstrap returns {code: 200, data: {sitename, ...}}.
    if (!body?.data?.sitename) {
      throw new AutomadMcpError("AUTH", "Login probe failed: session is not authenticated (no sitename in response data)", { retryable: false });
    }
  }

  private async scrapeCsrf(): Promise<void> {
    const url = this.cfg.url.replace(/\/$/, "") + "/dashboard";
    const res = await fetch(url, {
      headers: this.cookie ? { Cookie: this.cookie } : {},
      redirect: "follow",
    });
    if (!res.ok) {
      throw new AutomadMcpError("AUTH", `Failed to fetch dashboard for CSRF: HTTP ${res.status}`);
    }
    // v2 may rotate the session cookie on /dashboard (e.g. when the previous
    // session expired or the bootstrap completed mid-request). Adopt the new
    // cookie so the next authenticated request uses the matching session.
    const rotated = collectCookie([res.headers as HeaderLike | undefined ?? undefined]);
    if (rotated) this.cookie = rotated;
    const html = await res.text();
    const m = CSRF_RE.exec(html);
    if (!m || !m[1]) {
      throw new AutomadMcpError("AUTH", "Could not extract CSRF token from dashboard HTML");
    }
    this.csrf = m[1];
  }
}

type HeaderLike = { getSetCookie?: () => string[] | undefined; get?: (k: string) => string | null };
function isHeaderLike(v: unknown): v is HeaderLike {
  return typeof v === "object" && v !== null;
}

/** Pulls the first session cookie (HttpOnly `Automad-<md5>=<id>`) out of one or more Set-Cookie headers. */
function collectCookie(setCookies: Array<string | HeaderLike | null | undefined>): string | undefined {
  for (const sc of setCookies) {
    if (!sc) continue;
    // Headers object form (test mocks / older runtimes): `getSetCookie()` may be missing.
    if (isHeaderLike(sc)) {
      if (typeof sc.getSetCookie === "function") {
        const multi = sc.getSetCookie();
        if (multi && multi.length > 0) return collectCookie(multi);
      }
      const single = sc.get?.("set-cookie");
      if (single) {
        const first = single.split(";")[0];
        if (first && first.includes("=")) return first;
      }
      continue;
    }
    // String form (real Set-Cookie header line).
    const first = sc.split(";")[0];
    if (first && first.includes("=")) return first;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
