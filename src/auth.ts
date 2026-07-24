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
    await this.scrapeCsrf();
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
    this.cookie = collectCookie(res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")]);
    if (!this.cookie) {
      throw new AutomadMcpError("AUTH", "No session cookie returned by Automad v2 login");
    }
    logger.info("Dashboard login successful");

    // CSRF was minted during login; fetch it now.
    await this.scrapeCsrf();
  }

  private async scrapeCsrf(): Promise<void> {
    const url = this.cfg.url.replace(/\/$/, "") + "/dashboard";
    const res = await fetch(url, {
      headers: this.cookie ? { Cookie: this.cookie } : {},
      redirect: "follow",
    });
    if (!res.ok) {
      throw new AutomadMcpError(
        "AUTH",
        `Failed to fetch dashboard for CSRF: HTTP ${res.status}`,
      );
    }
    const html = await res.text();
    const m = CSRF_RE.exec(html);
    if (!m || !m[1]) {
      throw new AutomadMcpError("AUTH", "Could not extract CSRF token from dashboard HTML");
    }
    this.csrf = m[1];
  }
}

/** Pulls the first session cookie (HttpOnly `Automad-<md5>=<id>`) out of one or more Set-Cookie headers. */
function collectCookie(setCookies: Array<string | null | undefined>): string | undefined {
  for (const sc of setCookies) {
    if (!sc) continue;
    const first = sc.split(";")[0];
    if (first && first.includes("=")) return first;
  }
  return undefined;
}
