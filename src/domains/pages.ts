import { AutomadMcpError } from "../errors.js";
import { API_BASE } from "../config.js";
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
  const permit = guard.check(ACTION_MAP[input.action], input.url ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list": {
      // GET /_api/public/pagelist is public. NOTE: on 2.0.0-beta.15 the endpoint
      // currently 500s (Automad bug, PublicController.php:107) — the call is
      // still issued; the HttpClient surfaces the error faithfully.
      const params = new URLSearchParams();
      if (input.context) params.set("context", input.context);
      if (input.fields_csv) params.set("fields", input.fields_csv);
      const qs = params.toString();
      return client.get(`${API_BASE}/public/pagelist${qs ? `?${qs}` : ""}`);
    }
    case "get": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required");
      return client.post(`${API_BASE}/page/data`, { url: input.url });
    }
    case "create": {
      if (!input.title) throw new AutomadMcpError("VALIDATION", "title is required for create");
      if (!input.target_url && !input.url) {
        throw new AutomadMcpError("VALIDATION", "target_url (parent page) is required for create");
      }
      const payload: Record<string, unknown> = {
        targetPage: input.target_url ?? input.url,
        title: input.title,
      };
      if (input.template) payload["theme_template"] = input.template;
      if (input.private !== undefined) payload["private"] = input.private;
      return client.post(`${API_BASE}/page/add`, payload);
    }
    case "update": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for update");
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data["title"] = input.title;
      if (input.private !== undefined) data["private"] = input.private;
      if (input.tags !== undefined) data["tags"] = input.tags.join(",");
      if (input.fields) Object.assign(data, input.fields);
      const payload: Record<string, unknown> = { url: input.url, data };
      if (input.template) payload["theme_template"] = input.template;
      return client.post(`${API_BASE}/page/data`, payload);
    }
    case "delete": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for delete");
      return client.post(`${API_BASE}/page/delete`, { url: input.url });
    }
    case "move": {
      if (!input.url || !input.target_url) {
        throw new AutomadMcpError("VALIDATION", "url and target_url required");
      }
      const payload: Record<string, unknown> = { url: input.url, targetPage: input.target_url };
      if (input.layout) payload["layout"] = input.layout;
      return client.post(`${API_BASE}/page/move`, payload);
    }
    case "duplicate": {
      if (!input.url || !input.target_url) {
        throw new AutomadMcpError("VALIDATION", "url and target_url required for duplicate");
      }
      // v2 has no dedicated duplicate endpoint; semantics = create a new page
      // at target_url using the source's content. The cleanest v2 expression is
      // to surface this as a constrained create with the same field set.
      throw new AutomadMcpError(
        "UNSUPPORTED",
        "duplicate has no dedicated /_api endpoint in v2; read the source page and POST /_api/page/add with its fields",
      );
    }
  }
}
