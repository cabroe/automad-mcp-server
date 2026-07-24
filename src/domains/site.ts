import { AutomadMcpError } from "../errors.js";
import { API_BASE } from "../config.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { SiteInput } from "../schemas.js";

type SiteAction = SiteInput["action"];

const ACTION_MAP: Record<SiteAction, WriteAction> = {
  info: "site.info",
  search: "site.search",
};

interface BootstrapData {
  version?: string;
  sitename?: string;
  envKeys?: Record<string, unknown>;
  dashboard?: string;
  languages?: Record<string, string>;
  fileTypes?: Record<string, unknown>;
  reservedFields?: Record<string, unknown>;
  text?: Record<string, string>;
}

export async function handleSite(
  input: SiteInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], "/", input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError("FORBIDDEN", permit.reason);
  if (permit.allowed === "pending") return permit;

  switch (input.action) {
    case "info": {
      const data = (await client.get<BootstrapData>(`${API_BASE}/app/bootstrap`)) ?? {};
      return {
        version: data.version,
        sitename: data.sitename,
        languages: data.languages ?? {},
        fileTypes: data.fileTypes ?? {},
        reservedFields: data.reservedFields ?? {},
        dashboard: data.dashboard,
      };
    }
    case "search": {
      if (!input.query || !input.query.trim()) {
        throw new AutomadMcpError("VALIDATION", "query is required for search (got empty or whitespace-only)");
      }
      const payload: Record<string, unknown> = {
        searchValue: input.query,
        isRegex: input.is_regex ?? false,
        isCaseSensitive: input.is_case_sensitive ?? false,
      };
      if (input.replace !== undefined) payload["replaceValue"] = input.replace;
      return client.post(`${API_BASE}/search/search-replace`, payload);
    }
  }
}
