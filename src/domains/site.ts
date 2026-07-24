import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { SiteInput } from "../schemas.js";

type SiteAction = SiteInput["action"];

const ACTION_MAP: Record<SiteAction, WriteAction> = {
  info: "site.info",
  search: "site.search",
  backup: "site.backup",
  restore: "site.restore",
};

export async function handleSite(
  input: SiteInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.backup_path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "info":
      return client.get("/dashboard/api/system");
    case "search": {
      if (!input.query) throw new AutomadMcpError("VALIDATION", "query is required");
      return client.get("/dashboard/api/search?q=" + encodeURIComponent(input.query));
    }
    case "backup": {
      return client.post("/dashboard/api/backup");
    }
    case "restore": {
      if (!input.backup_path) {
        throw new AutomadMcpError("VALIDATION", "backup_path is required");
      }
      return client.post("/dashboard/api/backup/restore", { path: input.backup_path });
    }
  }
}
