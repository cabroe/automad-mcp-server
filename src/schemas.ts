import { z } from "zod";

export const writeMode = z.enum(["read-only", "confirm-destructive", "unrestricted"]);

const urlSchema = z.string().min(1).regex(/^\//, "url must start with /");



/** A single page mutation for `batch_update`. */
const pageBatchItem = z.object({
  url: urlSchema,
  title: z.string().optional(),
  template: z.string().optional(),
  private: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  fields: z.record(z.unknown()).optional(),
  /** Publish after saving (default true). Set false to keep as a draft. */
  publish: z.boolean().optional(),
  /** Required per-item when this item changes `title` (effective rename). */
  confirm_token: z.string().optional(),
});

/** Pages: list, get, create, update, delete, move, duplicate, publish, batch_update. */
export const pagesInput = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "move", "duplicate", "publish", "batch_update"]),
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
  /** create/update: publish after saving (default true). Set false for a draft. */
  publish: z.boolean().optional(),
  /** batch_update: list of page mutations applied sequentially. */
  items: z.array(pageBatchItem).optional(),
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
  action: z.enum(["info", "search", "health"]),
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

/**
 * Theme tooling: list, install (clone/copy), activate (v2 _api/package-manager),
 * uninstall, scaffold (new theme from starter kit), build (npm install + build),
 * read/write/files (theme file operations).
 */
export const themeInput = z.object({
  action: z.enum([
    "list", "install", "activate", "uninstall",
    "scaffold", "build",
    "read", "write", "files", "analyze", "validate", "schema",
    "diff", "generate",
  ]),
  /** Theme slug (directory name under AUTOMAD_THEMES_PATH). */
  theme: z.string().optional(),
  /** Install: git URL or local path. */
  source: z.string().optional(),
  /** Scaffold: theme display name. */
  name: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  version: z.string().optional(),
  /** Read/write/files: path relative to the theme root (forward slashes). */
  path: z.string().optional(),
  /** Write: file content. */
  content: z.string().optional(),
  /** Build: run `npm install` first (default true). */
  install: z.boolean().optional(),
  /** Generate: template kind (nav, pagelist, breadcrumbs, component, block, i18n, snippet). */
  kind: z.string().optional(),
  confirm_token: z.string().optional(),
});

export type ThemeInput = z.infer<typeof themeInput>;

/** Docs: offline Automad knowledge base (list, search, get). */
export const docsInput = z.object({
  action: z.enum(["list", "search", "get"]),
  /** search: query terms. */
  query: z.string().optional(),
  /** get: doc page slug. */
  slug: z.string().optional(),
  /** search: max results (default 5). */
  limit: z.number().int().positive().max(20).optional(),
  confirm_token: z.string().optional(),
});

export type DocsInput = z.infer<typeof docsInput>;

export const PageListResponse = z.array(z.object({
  url: z.string(),
  title: z.string().optional(),
}));

export const AuthBootstrapResponse = z.object({
  code: z.number(),
  data: z.object({ sitename: z.string().optional() }).optional(),
  error: z.string().optional(),
});
