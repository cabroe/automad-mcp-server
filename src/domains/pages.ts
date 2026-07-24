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
      const created = (await client.post(`${API_BASE}/page/add`, payload)) as { redirect?: string };
      // page/add produces a draft. v2's read endpoints only see published pages,
      // so publish the new draft to make subsequent get/list/move/delete behave intuitively.
      const slug = extractSlugFromRedirect(created.redirect) ?? input.url;
      if (slug) {
        try {
          await client.post(`${API_BASE}/page/publish`, { url: slug });
        } catch {
          /* best-effort: publish failure shouldn't fail the create */
        }
      }
      return { ok: true, url: slug, ...created };
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
      const updated = (await client.post(`${API_BASE}/page/data`, payload)) as { slug?: string };
      // page/data save produces a draft. v2's `page/publish` takes the page's
      // *directory* URL (not the draft slug) and applies the pending draft —
      // including renaming the directory to the new slug if the title changed.
      try {
        await client.post(`${API_BASE}/page/publish`, { url: input.url });
      } catch {
        /* best-effort */
      }
      return { ...updated, url: input.url };
    }
    case "delete": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for delete");
      return client.post(`${API_BASE}/page/delete`, { url: input.url });
    }
    case "move": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for move");
      // v2's page/move is **sibling reordering**, not path-rename: it takes a
      // `layout` array describing the new order of sibling URLs. There is no
      // v2 endpoint to "rename" or "move a page to a different path".
      if (!input.layout) {
        throw new AutomadMcpError(
          "UNSUPPORTED",
          "v2 page/move is sibling reordering: pass `layout` as a JSON array of sibling URLs in the new order. " +
            "There is no v2 endpoint to rename or relocate a page; recreate via page/add + page/delete instead.",
        );
      }
      return client.post(`${API_BASE}/page/move`, {
        url: input.url,
        layout: input.layout,
      });
    }
    case "duplicate": {
      throw new AutomadMcpError(
        "UNSUPPORTED",
        "duplicate has no dedicated /_api endpoint in v2; read the source page and POST /_api/page/add with its fields",
      );
    }
  }
}

/** Parse `page?url=%2Fblog%2Fhello` -> `/blog/hello`. */
function extractSlugFromRedirect(redirect: string | undefined): string | undefined {
  if (!redirect) return undefined;
  const m = /[?&]url=([^&]+)/.exec(redirect);
  if (!m || !m[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}
