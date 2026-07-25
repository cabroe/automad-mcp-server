import { AutomadMcpError } from "../errors.js";
import { API_BASE } from "../config.js";
import { PageListResponse } from "../schemas.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { PagesInput } from "../schemas.js";

type PagesAction = PagesInput["action"];

const ACTION_MAP: Record<PagesAction, WriteAction> = {
  list: "pages.list", get: "pages.get", create: "pages.create", update: "pages.update",
  delete: "pages.delete", move: "pages.move", duplicate: "pages.duplicate",
  publish: "pages.publish", batch_update: "pages.batch_update",
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
      return PageListResponse.parse(result);
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
      if (slug && input.publish !== false) await publishAndWait(client, slug, slug);
      return { ok: true, url: slug, ...created };
    }
    case "update": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for update");
      return updateOnePage(client, {
        url: input.url,
        title: input.title,
        template: input.template,
        private: input.private,
        tags: input.tags,
        fields: input.fields,
        publish: input.publish,
      });
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
    case "publish": {
      if (!input.url) throw new AutomadMcpError("VALIDATION", "url is required for publish");
      await client.post(`${API_BASE}/page/publish`, { url: input.url });
      return { ok: true, url: input.url, published: true };
    }
    case "batch_update": {
      if (!input.items || input.items.length === 0) {
        throw new AutomadMcpError("VALIDATION", "items is required for batch_update (non-empty array)");
      }
      const results: Array<{ url: string; ok: boolean; resultingUrl?: string; error?: string }> = [];
      // Sequential on purpose: v2 races on concurrent title-renames of the same tree.
      for (const item of input.items) {
        try {
          const res = await updateOnePage(client, item);
          results.push({ url: item.url, ok: true, resultingUrl: res.url });
        } catch (err) {
          results.push({ url: item.url, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { ok: results.every((r) => r.ok), results };
    }
  }
}

interface PageUpdateFields {
  url: string;
  title?: string | undefined;
  template?: string | undefined;
  private?: boolean | undefined;
  tags?: string[] | undefined;
  fields?: Record<string, unknown> | undefined;
  /** Publish after saving (default true). */
  publish?: boolean | undefined;
}

/** Save one page via /_api/page/data, then publish unless `publish === false`. */
async function updateOnePage(client: HttpClient, item: PageUpdateFields): Promise<{ ok: true; url: string }> {
  const data: Record<string, unknown> = {};
  if (item.title !== undefined) {
    if (!item.title.trim()) {
      throw new AutomadMcpError("VALIDATION", `title cannot be empty or whitespace-only for ${item.url}`);
    }
    data["title"] = item.title;
  }
  if (item.private !== undefined) data["private"] = item.private;
  if (item.tags !== undefined) data["tags"] = item.tags.join(",");
  if (item.fields) Object.assign(data, item.fields);
  const payload: Record<string, unknown> = { url: item.url, data };
  if (item.template) payload["theme_template"] = item.template;
  const saved = (await client.post(`${API_BASE}/page/data`, payload)) as { slug?: string };
  const resultingUrl = saved.slug ? `/${saved.slug}` : item.url;
  if (item.publish !== false) await publishAndWait(client, item.url, resultingUrl);
  return { ok: true, url: resultingUrl };
}

function extractSlugFromRedirect(redirect: string | undefined): string | undefined {
  if (!redirect) return undefined;
  const m = /[?&]url=([^&]+)/.exec(redirect);
  if (!m || !m[1]) return undefined;
  try { return decodeURIComponent(m[1]); } catch { return undefined; }
}
