import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { ThemeInput } from "../schemas.js";

type ThemeAction = ThemeInput["action"];

const ACTION_MAP: Record<ThemeAction, WriteAction> = {
  list: "theme.list",
  install: "theme.install",
  activate: "theme.activate",
  uninstall: "theme.uninstall",
};

export async function handleTheme(
  input: ThemeInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.theme ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/themes");
    case "install": {
      if (!input.source) throw new AutomadMcpError("VALIDATION", "source is required");
      const isStarterKit = input.source.includes("automad-theme-starter-kit");
      return client.post("/dashboard/api/themes/install", {
        source: input.source,
        theme: input.theme,
        bootstrap_starter_kit: isStarterKit,
        steps: isStarterKit
          ? [
              "git clone <repo> into Automad packages directory",
              "cp .env.example .env and set AUTOMAD_BASE",
              "npm install",
              "Update composer.json and theme.json (name, description)",
              "npm run dev",
            ]
          : undefined,
      });
    }
    case "activate": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required");
      return client.post("/dashboard/api/themes/activate", { theme: input.theme });
    }
    case "uninstall": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required");
      return client.delete(`/dashboard/api/themes/${encodeURIComponent(input.theme)}`);
    }
  }
}
