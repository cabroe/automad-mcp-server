import { z } from 'zod';
import {
  advertisedActions,
  type AdvertisedAction,
  type ToolName,
} from './capabilities/registry.js';

export const writeMode = z.enum(['read-only', 'confirm-destructive', 'unrestricted']);

/**
 * A tool's `action` enum, built from the capability registry instead of a
 * hand-written literal: adding an action to the registry automatically
 * extends every relevant tool schema without any second list to update.
 */
function actionEnum<T extends ToolName>(
  tool: T,
): z.ZodEnum<[AdvertisedAction<T>, ...AdvertisedAction<T>[]]> {
  // The `satisfies` check below would error if `advertisedActions(tool)` is empty
  // — that's an intentional compile-time guarantee that every tool has at
  // least one callable action.
  return z.enum(advertisedActions(tool) as [AdvertisedAction<T>, ...AdvertisedAction<T>[]]);
}

/** Max bytes accepted in a single media upload source (base64 string length, including padding). */
export const MAX_BASE64_INPUT = 12 * 1024 * 1024; // ~9 MB decoded (covers most images/SVGs/PDFs)

/** Cap on a single `pages.batch_update` payload (sequential; protect against OOM/DoS). */
export const MAX_BATCH_ITEMS = 200;

/** Cap on a single `theme.write` content (file size on disk; protect against OOM/DoS). */
export const MAX_THEME_FILE_BYTES = 4 * 1024 * 1024; // 4 MB — well above any reasonable theme asset

/**
 * Length caps for user-facing free-form string fields. The values are intentionally
 * generous (well above any legitimate value) — the goal is to refuse unbounded
 * inputs early in the Zod schema rather than letting them reach the filesystem
 * or HTTP layer. Three tiers:
 *   - MAX_SHORT  (255):  titles, slugs, identifiers, mime types
 *   - MAX_MEDIUM (1024): descriptions, paths, layouts, search queries
 *   - MAX_LONG   (4096): search-replace strings, free-form text fields
 */
export const MAX_SHORT = 255;
export const MAX_MEDIUM = 1024;
export const MAX_LONG = 4096;
export const MAX_SLUG = 96;

const urlSchema = z.string().min(1).regex(/^\//, 'url must start with /');

/** A single page mutation for `batch_update`. */
const pageBatchItem = z.object({
  url: urlSchema,

  title: z.string().max(MAX_SHORT).optional(),
  /** Theme/template binding for this page. Format: `"{theme}/{template}"` (no `.php`).
   *  v2 splits on the first `/` and appends `.php`, so `my-theme/page` resolves
   *  to `packages/my-theme/page.php`. Site-default themes are not exposed via
   *  the API — bind per page via this field. */
  template: z.string().max(MAX_SHORT).optional(),
  private: z.boolean().optional(),
  tags: z.array(z.string().max(MAX_SHORT)).max(50).optional(),
  fields: z.record(z.unknown()).optional(),
  /** Publish after saving (default true). Set false to keep as a draft. */
  publish: z.boolean().optional(),
  /** Required per-item when this item changes `title` (effective rename). */
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

/** Pages: list, get, create, update, delete, move, duplicate, publish, batch_update. */
export const pagesInput = z.object({
  action: actionEnum('automad_pages'),
  url: urlSchema.optional(),
  title: z.string().max(MAX_SHORT).optional(),
  /** Theme/template binding. Format: `"{theme}/{template}"` (no `.php`).
   *  v2 splits on `/` and appends `.php`, so `my-theme/page` resolves to
   *  `packages/my-theme/page.php`. Pass on `create` to bind a non-default theme. */
  template: z.string().max(MAX_SHORT).optional(),
  private: z.boolean().optional(),
  tags: z.array(z.string().max(MAX_SHORT)).max(50).optional(),
  /** Template-defined field map (e.g. `main`, `hero`, `+main` for blocks). */
  fields: z.record(z.unknown()).optional(),
  /** Only used by `list`. */
  fields_csv: z.string().max(MAX_LONG).optional(),
  context: urlSchema.optional(),
  /** For `move`: destination page URL. */
  target_url: urlSchema.optional(),
  /** Sibling reordering layout (JSON string), passed to page/move. */
  layout: z.string().max(MAX_MEDIUM).optional(),
  /** create/update: publish after saving (default true). Set false for a draft. */
  publish: z.boolean().optional(),
  /** batch_update: list of page mutations applied sequentially. */
  items: z
    .array(pageBatchItem)
    .max(MAX_BATCH_ITEMS, `batch_update supports at most ${MAX_BATCH_ITEMS} items per call`)
    .optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
  /** For `history_restore`: the history log entry id. */
  history_id: z.string().max(MAX_SHORT).optional(),
});

/** Media: list, upload, delete. (rename: not supported by v2 — `move` only moves between directories; get: no v2 endpoint.) */
export const mediaInput = z.object({
  action: actionEnum('automad_media'),
  url: urlSchema.optional(),
  /** For `delete`: the file name within `url`'s directory. v2's `selected` is a `{file: true}` map. */
  filename: z.string().max(MAX_SHORT).optional(),
  source: z
    .object({
      base64: z
        .string()
        .max(MAX_BASE64_INPUT, `base64 payload exceeds ${MAX_BASE64_INPUT} chars; check the size`),
      filename: z.string().max(MAX_SHORT),
      mimeType: z.string().max(127),
    })
    .optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

/** Shared: site-wide data (sitename, consent, etc.). Snippets are part of components in v2. */
export const sharedInput = z.object({
  action: actionEnum('automad_shared'),
  /** Template-defined field map for `set`. */
  fields: z.record(z.unknown()).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

/**
 * Config: `get` reads from /_api/app/bootstrap (envKeys + sitename + version), `set` posts
 * to /_api/config/update with a type discriminator. There is no `validate` in v2.
 */
export const configInput = z.object({
  action: actionEnum('automad_config'),
  /** `set` requires `type` + matching payload; ignored for `get`. */
  type: z
    .enum([
      'aiEnabled',
      'aiInstructions',
      'cache',
      'debug',
      'feed',
      'i18n',
      'translation',
      'sessionCookieSalt',
    ])
    .optional(),
  payload: z.record(z.unknown()).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

/** Site: info (from bootstrap), search (search-replace, read-only when no replace). */
export const siteInput = z.object({
  action: actionEnum('automad_site'),
  query: z.string().max(MAX_MEDIUM).optional(),
  /** search-replace flags; defaults are read-only site search. */
  replace: z.string().max(MAX_LONG).optional(),
  is_regex: z.boolean().optional(),
  is_case_sensitive: z.boolean().optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

export type PagesInput = z.infer<typeof pagesInput>;
export type MediaInput = z.infer<typeof mediaInput>;
export type SharedInput = z.infer<typeof sharedInput>;
export type ConfigInput = z.infer<typeof configInput>;
export type SiteInput = z.infer<typeof siteInput>;

/**
 * Theme tooling: list, install (clone/copy), activate (v2 _api/package-manager),
 * uninstall, scaffold (new theme from starter kit), build (npm install + build),
 * read/write/files for theme file operations.
 */
export const themeInput = z.object({
  action: actionEnum('automad_theme'),
  /** Theme slug (directory name under AUTOMAD_THEMES_PATH). */
  theme: z.string().max(MAX_SLUG).optional(),
  /** Install: git URL or local path. */
  source: z.string().max(MAX_MEDIUM).optional(),
  /** Scaffold: theme display name. */
  name: z.string().max(MAX_SHORT).optional(),
  description: z.string().max(MAX_MEDIUM).optional(),
  author: z.string().max(MAX_SHORT).optional(),
  license: z.string().max(MAX_SHORT).optional(),
  version: z.string().max(MAX_SHORT).optional(),
  /** Read/write/files: path relative to the theme root (forward slashes). */
  path: z.string().max(MAX_MEDIUM).optional(),
  /** Write: file content. */
  content: z
    .string()
    .max(MAX_THEME_FILE_BYTES, `theme.write content exceeds ${MAX_THEME_FILE_BYTES} bytes`)
    .optional(),
  /** Build: run `npm install` first (default true). */
  install: z.boolean().optional(),
  /** Dev: preferred local port for the detached server. */
  port: z.number().int().min(1).max(65535).optional(),
  /** Generate: template kind (nav, pagelist, breadcrumbs, component, block, i18n, snippet). */
  kind: z.string().max(64).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

export type ThemeInput = z.infer<typeof themeInput>;

/** Docs: offline Automad knowledge base (list, search, get). */
export const docsInput = z.object({
  action: actionEnum('automad_docs'),
  /** search: query terms. */
  query: z.string().max(MAX_MEDIUM).optional(),
  /** get: doc page slug. */
  slug: z.string().max(MAX_SLUG).optional(),
  /** search: max results (default 5). */
  limit: z.number().int().positive().max(20).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});

export type DocsInput = z.infer<typeof docsInput>;

/**
 * Discover: introspect the tool/action surface instead of holding every
 * action's details in context up front (discovery-facade pattern).
 */
export const discoverInput = z.object({
  action: actionEnum('automad_discover'),
  /** describe: tool name, e.g. "automad_pages". list: optional filter to one tool. */
  tool: z.string().max(MAX_SHORT).optional(),
  /** describe: narrow to one action within `tool` (omit to describe the whole tool). */
  target_action: z.string().max(MAX_SHORT).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
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
  automad_theme: themeInput,
  automad_docs: docsInput,
  automad_discover: discoverInput,
} satisfies Record<ToolName, z.ZodTypeAny>;

/** Widened for lookups by an unvalidated tool name (`automad_discover`'s `describe`). */
export const TOOL_INPUT_SCHEMAS: Readonly<Record<string, z.ZodTypeAny | undefined>> =
  toolInputSchemas;

/**
 * List-pages response shape. The v2 backend returns `pages: Page[]` where
 * each `Page` has the URL fields the MCP needs to render a useful list.
 */
export const PageListResponse = z.array(
  z.object({
    url: z.string(),
    title: z.string().optional(),
    template: z.string().optional(),
    theme: z.string().optional(),
    private: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    modified: z.string().optional(),
  }),
);

/** Bootstrap (`/_api/app/bootstrap`) response. Fields vary by v2 build; all are optional. */
export const AuthBootstrapResponse = z.object({
  version: z.string().optional(),
  sitename: z.string().optional(),
  envKeys: z.array(z.string()).optional(),
  liveEnabled: z.boolean().optional(),
});
