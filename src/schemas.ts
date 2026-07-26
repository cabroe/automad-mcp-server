import { z } from "zod";
import { advertisedActions, type AdvertisedAction, type ToolName } from "./capabilities/registry.js";

export const writeMode = z.enum(["read-only", "confirm-destructive", "unrestricted"]);

/**
 * A tool's `action` enum, built from the capability registry instead of a
 * hand-written literal list. The registry is the single source of truth: an
 * action added there becomes callable here, and the resulting literal union
 * makes every domain router's `Record<Action, WriteAction>` map fail to compile
 * until it handles the new case. Internal, guard-only actions are excluded.
 */
function actionEnum<T extends ToolName>(tool: T): z.ZodEnum<[AdvertisedAction<T>, ...AdvertisedAction<T>[]]> {
  const [first, ...rest] = advertisedActions(tool);
  // `validateCapabilityRegistry` rejects a tool without callable actions; this
  // narrows the array to the non-empty tuple `z.enum` requires.
  if (first === undefined) throw new Error(`Capability ${tool} declares no callable actions`);
  return z.enum([first, ...rest]);
}

/** Max bytes accepted in a single media upload source (base64 string length, including padding). */
export const MAX_BASE64_INPUT = 12 * 1024 * 1024; // ~9 MB decoded (covers most images/SVGs/PDFs)

/** Cap on a single `pages.batch_update` payload (sequential; protect against OOM/DoS). */
export const MAX_BATCH_ITEMS = 200;

/** Cap on a single `theme.write` content (file size on disk; protect against OOM/DoS). */
export const MAX_THEME_FILE_BYTES = 4 * 1024 * 1024; // 4 MB — well above any reasonable theme asset

const urlSchema = z.string().min(1).regex(/^\//, "url must start with /");



/** A single page mutation for `batch_update`. */
const pageBatchItem = z.object({
  url: urlSchema,

  title: z.string().optional(),
  /** Theme/template binding. Format: `"{theme}/{template}"` (no `.php`).
   *  v2 splits on `/` and appends `.php`, so `my-theme/page` resolves to
   *  `packages/my-theme/page.php`. Binds the page to a non-default theme. */
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
  action: actionEnum("automad_pages"),
  url: urlSchema.optional(),
  title: z.string().optional(),
  /** Theme/template binding. Format: `"{theme}/{template}"` (no `.php`).
   *  v2 splits on `/` and appends `.php`, so `my-theme/page` resolves to
   *  `packages/my-theme/page.php`. Pass on `create` to bind a non-default theme. */
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
  items: z.array(pageBatchItem).max(MAX_BATCH_ITEMS, `batch_update supports at most ${MAX_BATCH_ITEMS} items per call`).optional(),
  confirm_token: z.string().optional(),
});

/** Media: list, upload, delete. (rename: not supported by v2 — `move` only moves between directories; get: no v2 endpoint.) */
export const mediaInput = z.object({
  action: actionEnum("automad_media"),
  url: urlSchema.optional(),
  /** For `delete`: the file name within `url`'s directory. v2's `selected` is a `{file: true}` map. */
  filename: z.string().max(255).optional(),
  source: z
    .object({
      base64: z.string().max(MAX_BASE64_INPUT, `base64 payload exceeds ${MAX_BASE64_INPUT} chars; check the size`),
      filename: z.string().max(255),
      mimeType: z.string().max(127),
    })
    .optional(),
  confirm_token: z.string().optional(),
});

/** Shared: site-wide data (sitename, consent, etc.). Snippets are part of components in v2. */
export const sharedInput = z.object({
  action: actionEnum("automad_shared"),
  /** Template-defined field map for `set`. */
  fields: z.record(z.unknown()).optional(),
  confirm_token: z.string().optional(),
});

/**
 * Config: `get` reads from /_api/app/bootstrap (envKeys + sitename + version), `set` posts
 * to /_api/config/update with a type discriminator. There is no `validate` in v2.
 */
export const configInput = z.object({
  action: actionEnum("automad_config"),
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
  action: actionEnum("automad_site"),
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
  action: actionEnum("automad_theme"),
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
  content: z.string().max(MAX_THEME_FILE_BYTES, `theme.write content exceeds ${MAX_THEME_FILE_BYTES} bytes`).optional(),
  /** Build: run `npm install` first (default true). */
  install: z.boolean().optional(),
  /** Dev: preferred local port for the detached server. */
  port: z.number().int().min(1).max(65535).optional(),
  /** Generate: template kind (nav, pagelist, breadcrumbs, component, block, i18n, snippet). */
  kind: z.string().optional(),
  confirm_token: z.string().optional(),
});

export type ThemeInput = z.infer<typeof themeInput>;

/** Docs: offline Automad knowledge base (list, search, get). */
export const docsInput = z.object({
  action: actionEnum("automad_docs"),
  /** search: query terms. */
  query: z.string().optional(),
  /** get: doc page slug. */
  slug: z.string().optional(),
  /** search: max results (default 5). */
  limit: z.number().int().positive().max(20).optional(),
  confirm_token: z.string().optional(),
});

export type DocsInput = z.infer<typeof docsInput>;

/**
 * Discover: introspect the tool/action surface instead of holding every
 * action's details in context up front (discovery-facade pattern).
 */
export const discoverInput = z.object({
  action: actionEnum("automad_discover"),
  /** describe: tool name, e.g. "automad_pages". list: optional filter to one tool. */
  tool: z.string().optional(),
  /** describe: narrow to one action within `tool` (omit to describe the whole tool). */
  target_action: z.string().optional(),
  confirm_token: z.string().optional(),
});

export type DiscoverInput = z.infer<typeof discoverInput>;

/**
 * Tool name → input schema. Total over `ToolName`, so a capability added to the
 * registry doesn't compile until it has a schema. Consumed by the tool bindings
 * (MCP registration) and by `automad_discover`'s `describe`.
 */
const toolInputSchemas = {
  automad_pages: pagesInput,
  automad_media: mediaInput,
  automad_shared: sharedInput,
  automad_config: configInput,
  automad_site: siteInput,
  automad_docs: docsInput,
  automad_theme: themeInput,
  automad_discover: discoverInput,
} satisfies Record<ToolName, z.ZodTypeAny>;

/** Widened for lookups by an unvalidated tool name (`automad_discover`'s `describe`). */
export const TOOL_INPUT_SCHEMAS: Readonly<Record<string, z.ZodTypeAny | undefined>> = toolInputSchemas;

export const PageListResponse = z.array(z.object({
  url: z.string(),
  title: z.string().optional(),
}));

export const AuthBootstrapResponse = z.object({
  code: z.number(),
  data: z.object({ sitename: z.string().optional() }).optional(),
  error: z.string().optional(),
});
