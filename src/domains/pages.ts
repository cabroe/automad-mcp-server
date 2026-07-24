import { AutomadMcpError } from "../errors.js";
import { API_BASE } from "../config.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { PagesInput } from "../schemas.js";

type PagesAction = PagesInput["action"];

const ACTION_MAP: Record<PagesAction, WriteAction> = {
  list: "pages.list", get: "pages.get", create: "pages.create", update: "pages.update",
  delete: "pages.delete", move: "pages.move", duplicate: "pages.duplicate",
};

const READ_RETRY_TOTAL_MS = 3000;
const READ_RETRY_INTERVAL_MS = 200;

async function publishAndWait(client: HttpClient, inputUrl: string, resultingUrl: string): Promise<void> {
  try {
    await client.post(`${API_BASE}/page/publish`, { url: inputUrl });
  } catch { return; }
  for (let i = 0; i < 8 && i * READ_RETRY_INTERVAL_MS < READ_RETRY_TOTAL_MS; i++) {
    await new Promise((r) => setTimeout(r, READ_RETRY_INTERVAL_MS));
    try { await client.post(`${API_BASE}/page/data`, { url: resultingUrl }); return; }
    catch { /* retry */ }
  }
}

async function readWithRetry(client: HttpClient, url: string): Promise<unknown> {
  let lastErr: unknown;
  const start = Date.now();
  while (Date.now() - start < READ_RETRY_TOTAL_MS) {
    try { return await client.post(`${API_BASE}/page/data`, { url }); }
    catch (err) {
      lastErr = err;
      const code = (err as { code?: unknown })?.code;
      if (code !== "NOT_FOUND") throw err;
      await new Promise((r) => setTimeout(r, READ_RETRY_INTERVAL_MS));
    }
  }
  throw lastErr;
}

export async function handlePages(
  input: PagesInput, client: HttpClient, guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.url ?? "/", input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError("FORBIDDEN", permit.reason);
  if (permit.allowed === "pending") return permit;

  switch (input.action) {
    case "list": {
      const result = await client.post(`${API_BASE}/page-collection/get-recently-edited`);
      return result;
    }
    case "get": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required");
      return readWithRetry(client, input.url);
    }
    case "create": {
      if (!input.title || !input.title.trim()) {
        throw new AutomadMcpError("VALIDATION", "title is required for create (got empty or whitespace-only)");
      }
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
      const slug = extractSlugFromRedirect(created.redirect) ?? input.url;
      if (slug) await publishAndWait(client, slug, slug);
      return { ok: true, url: slug, ...created };
    }
    case "update": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for update");
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) {
        if (!input.title.trim()) {
          throw new AutomadMcpError("VALIDATION", "title cannot be empty or whitespace-only");
        }
        data["title"] = input.title;
      }
      if (input.private !== undefined) data["private"] = input.private;
      if (input.tags !== undefined) data["tags"] = input.tags.join(",");
      if (input.fields) Object.assign(data, input.fields);
      const payload: Record<string, unknown> = { url: input.url, data };
      if (input.template) payload["theme_template"] = input.template;
      const saved = (await client.post(`${API_BASE}/page/data`, payload)) as { slug?: string };
      const resultingUrl = saved.slug ? `/${saved.slug}` : input.url;
      await publishAndWait(client, input.url, resultingUrl);
      return { ok: true, url: resultingUrl };
    }
    case "delete": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for delete");
      return client.post(`${API_BASE}/page/delete`, { url: input.url });
    }
    case "move": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for move");
      if (!input.target_url) {
        throw new AutomadMcpError("VALIDATION", "target_url (destination parent page) is required for move");
      }
      const payload: Record<string, unknown> = { url: input.url, targetPage: input.target_url };
      if (input.layout) {
        let parsedLayout: unknown;
        try { parsedLayout = JSON.parse(input.layout); }
        catch { throw new AutomadMcpError("VALIDATION", "layout must be a JSON-encoded array of sibling URLs (got unparseable string)"); }
        if (!Array.isArray(parsedLayout) || parsedLayout.length === 0) {
          throw new AutomadMcpError("VALIDATION", "layout must be a non-empty JSON array of sibling URL strings");
        }
        if (!parsedLayout.every((u: unknown) => typeof u === "string" && u.startsWith("/"))) {
          throw new AutomadMcpError("VALIDATION", "layout must contain only URL strings starting with /");
        }
        payload["layout"] = input.layout;
      }
      return client.post(`${API_BASE}/page/move`, payload);
    }
    case "duplicate": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for duplicate");
      return client.post(`${API_BASE}/page/duplicate`, { url: input.url });
    }
  }
}

function extractSlugFromRedirect(redirect: string | undefined): string | undefined {
  if (!redirect) return undefined;
  const m = /[?&]url=([^&]+)/.exec(redirect);
  if (!m || !m[1]) return undefined;
  try { return decodeURIComponent(m[1]); } catch { return undefined; }
}
