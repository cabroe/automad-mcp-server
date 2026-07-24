import { z } from "zod";

export const writeMode = z.enum(["read-only", "confirm-destructive", "unrestricted"]);

const urlSchema = z.string().min(1).regex(/^\//, "url must start with /");

const editorJsBlock = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

/** Pages: list, get, create, update, delete, move, duplicate. */
export const pagesInput = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "move", "duplicate"]),
  url: urlSchema.optional(),
  title: z.string().optional(),
  template: z.string().optional(),
  private: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  /** Template-defined field map (e.g. `main`, `hero`, `+main` for blocks). */
  fields: z.record(z.unknown()).optional(),
  /** Only used by `list`. */
  fields_csv: z.string().optional(),
  context: urlSchema.optional(),
  /** For `move`: destination page URL. */
  target_url: urlSchema.optional(),
  /** Sibling reordering layout (JSON string), passed to page/move. */
  layout: z.string().optional(),
  confirm_token: z.string().optional(),
});

/** Media: list, upload. (delete/rename/get: no v2 endpoints) */
export const mediaInput = z.object({
  action: z.enum(["list", "upload"]),
  url: urlSchema.optional(),
  source: z
    .object({ base64: z.string(), filename: z.string(), mimeType: z.string() })
    .optional(),
  confirm_token: z.string().optional(),
});

/** Shared: site-wide data (sitename, consent, etc.). Snippets are part of components in v2. */
export const sharedInput = z.object({
  action: z.enum(["get", "set"]),
  /** Template-defined field map for `set`. */
  fields: z.record(z.unknown()).optional(),
  confirm_token: z.string().optional(),
});

/**
 * Config: `get` reads from /_api/app/bootstrap (envKeys + sitename + version), `set` posts
 * to /_api/config/update with a type discriminator. There is no `validate` in v2.
 */
export const configInput = z.object({
  action: z.enum(["get", "set"]),
  /** `set` requires `type` + matching payload; ignored for `get`. */
  type: z
    .enum([
      "aiEnabled",
      "aiInstructions",
      "cache",
      "debug",
      "feed",
      "i18n",
      "translation",
      "sessionCookieSalt",
    ])
    .optional(),
  payload: z.record(z.unknown()).optional(),
  confirm_token: z.string().optional(),
});

/** Site: info (from bootstrap), search (search-replace, read-only when no replaceValue). */
export const siteInput = z.object({
  action: z.enum(["info", "search"]),
  query: z.string().optional(),
  /** search-replace flags; defaults are read-only site search. */
  replace: z.string().optional(),
  is_regex: z.boolean().optional(),
  is_case_sensitive: z.boolean().optional(),
  confirm_token: z.string().optional(),
});

export type PagesInput = z.infer<typeof pagesInput>;
export type MediaInput = z.infer<typeof mediaInput>;
export type SharedInput = z.infer<typeof sharedInput>;
export type ConfigInput = z.infer<typeof configInput>;
export type SiteInput = z.infer<typeof siteInput>;

// Kept for downstream tasks (page format unchanged from v1).
export { editorJsBlock };
