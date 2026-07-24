import { AutomadMcpError } from "./errors.js";
import { logger } from "./logger.js";
import type { AuthProvider } from "./client.js";
import type { Config } from "./config.js";

export class AuthManager implements AuthProvider {
  private cookie: string | undefined;
  private readonly loginUrl: string;

  constructor(private readonly cfg: Config) {
    this.loginUrl = cfg.url.replace(/\/$/, "") + "/dashboard";
  }

  async getCookie(force = false): Promise<string | undefined> {
    if (this.cfg.token) {
      return this.cfg.token;
    }
    if (this.cookie && !force) {
      return this.cookie;
    }
    await this.login();
    return this.cookie;
  }

  private async login(): Promise<void> {
    logger.info({ url: this.loginUrl, user: this.cfg.username }, "Logging into Automad dashboard");
    const res = await fetch(this.loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });

    if (!res.ok) {
      throw new AutomadMcpError(
        "AUTH",
        `Login failed: HTTP ${res.status}`,
        await safeJson(res),
      );
    }

    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      throw new AutomadMcpError("AUTH", "No session cookie returned by dashboard");
    }
    this.cookie = setCookie.split(";")[0] ?? "";
    logger.info("Dashboard login successful");
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
