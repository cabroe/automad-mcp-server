import { AutomadMcpError } from "../errors.js";
import { serializePage } from "../page-format.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { SnippetsInput } from "../schemas.js";

type SnippetsAction = SnippetsInput["action"];

const ACTION_MAP: Record<SnippetsAction, WriteAction> = {
  list: "snippets.list",
  get: "snippets.get",
  set: "snippets.set",
  delete: "snippets.delete",
};

export async function handleSnippets(
  input: SnippetsInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.name ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  const scope = input.scope ?? "local";
  const base = scope === "global" ? "/dashboard/api/shared/snippets" : "/dashboard/api/snippets";

  switch (input.action) {
    case "list":
      return client.get(base);
    case "get": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required");
      return client.get(`${base}/${encodeURIComponent(input.name)}`);
    }
    case "set": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required");
      if (!input.data) throw new AutomadMcpError("VALIDATION", "data is required");
      const raw = serializePage({
        variables: input.data.variables ?? {},
        blocks: (input.data.blocks ?? []).map((b) => ({ name: "block", data: b })),
      });
      return client.put(`${base}/${encodeURIComponent(input.name)}`, { raw });
    }
    case "delete": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required");
      return client.delete(`${base}/${encodeURIComponent(input.name)}`);
    }
  }
}
