import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { TemplatesInput } from "../schemas.js";

type TemplatesAction = TemplatesInput["action"];

const ACTION_MAP: Record<TemplatesAction, WriteAction> = {
  list: "templates.list",
  get: "templates.get",
  set: "templates.set",
  delete: "templates.delete",
  validate: "templates.validate",
};

export async function handleTemplates(
  input: TemplatesInput,
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
      return client.get("/dashboard/api/templates");
    case "get": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.get("/dashboard/api/templates?path=" + encodeURIComponent(input.path));
    }
    case "set": {
      if (!input.path || input.content === undefined) {
        throw new AutomadMcpError("VALIDATION", "path and content required");
      }
      return client.put("/dashboard/api/templates", { path: input.path, content: input.content });
    }
    case "delete": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.delete("/dashboard/api/templates?path=" + encodeURIComponent(input.path));
    }
    case "validate": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      const res = (await client.get(
        "/dashboard/api/templates?path=" + encodeURIComponent(input.path),
      )) as {
        path: string;
        content: string;
      };
      const result = validateTemplate(res.content);
      return { path: res.path, ...result };
    }
  }
}

// Automad block statements that must be closed with an `<@ end @>` tag.
// See https://automad.org/developer-guide/building-themes/template-language/control-structures
const BLOCK_OPENERS: ReadonlySet<string> = new Set(["if", "foreach", "snippet", "with"]);

function validateTemplate(content: string): { valid: boolean; error?: string } {
  // First guard against malformed delimiters (e.g. a `<@` with no matching `@>`).
  const open = (content.match(/<@/g) ?? []).length;
  const close = (content.match(/@>/g) ?? []).length;
  if (open !== close) {
    return { valid: false, error: `unbalanced tags: ${open} open, ${close} close` };
  }

  // Then verify block statements (foreach/if/with/snippet) are matched by `end`.
  const tags = content.match(/<@(.*?)@>/gs) ?? [];
  let depth = 0;
  for (const tag of tags) {
    const keyword = tag.slice(2, -2).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (keyword === "end") {
      depth--;
      if (depth < 0) {
        return { valid: false, error: "unbalanced tags: unexpected end" };
      }
    } else if (BLOCK_OPENERS.has(keyword)) {
      depth++;
    }
  }
  if (depth !== 0) {
    return { valid: false, error: `unbalanced tags: ${depth} unclosed block(s)` };
  }
  return { valid: true };
}
