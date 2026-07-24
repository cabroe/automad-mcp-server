import { AutomadMcpError } from "../errors.js";
import { parsePage, serializePage } from "../page-format.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { PagesInput } from "../schemas.js";

type PagesAction = PagesInput["action"];

const ACTION_MAP: Record<PagesAction, WriteAction> = {
  list: "pages.list",
  get: "pages.get",
  create: "pages.create",
  update: "pages.update",
  delete: "pages.delete",
  move: "pages.move",
  duplicate: "pages.duplicate",
};

export async function handlePages(
  input: PagesInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/pages");
    case "get": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.get(encodePath("/dashboard/api/pages", input.path));
    }
    case "create": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      if (!input.data) throw new AutomadMcpError("VALIDATION", "data is required for create");
      const raw = serializePage({
        variables: buildVariables(input.data.title, input.data.variables),
        blocks: (input.data.blocks ?? []).map((b) => ({ name: "block", data: b })),
      });
      return client.post("/dashboard/api/pages", { path: input.path, raw });
    }
    case "update": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      if (!input.data) throw new AutomadMcpError("VALIDATION", "data is required for update");
      const raw = serializePage({
        variables: buildVariables(input.data.title, input.data.variables),
        blocks: (input.data.blocks ?? []).map((b) => ({ name: "block", data: b })),
      });
      return client.put(encodePath("/dashboard/api/pages", input.path), { raw });
    }
    case "delete": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.delete(encodePath("/dashboard/api/pages", input.path), {
        headers: input.recursive ? { "X-Recursive": "1" } : {},
      });
    }
    case "move": {
      if (!input.path || !input.target_path) {
        throw new AutomadMcpError("VALIDATION", "path and target_path required");
      }
      return client.post(encodePath("/dashboard/api/pages", input.path) + "/move", {
        target: input.target_path,
      });
    }
    case "duplicate": {
      if (!input.path || !input.target_path) {
        throw new AutomadMcpError("VALIDATION", "path and target_path required");
      }
      return client.post(encodePath("/dashboard/api/pages", input.path) + "/duplicate", {
        target: input.target_path,
      });
    }
  }
}

function buildVariables(
  title: string | undefined,
  variables: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(variables ?? {}) };
  if (title !== undefined) merged.title = title;
  return merged;
}

function encodePath(base: string, path: string): string {
  return base + "/" + encodeURIComponent(path);
}

// Re-export for downstream tasks
export { parsePage, serializePage };
