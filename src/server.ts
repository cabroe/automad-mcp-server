import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readThemesList, readThemeSchema } from "./resources/themes.js";
import { getDoc, listDocs } from "./docs/kb.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HttpClient } from "./client.js";
import type { WriteGuard } from "./write-guard.js";
import type { Config } from "./config.js";
import { AutomadMcpError, errorToJson } from "./errors.js";
import { logger } from "./logger.js";
import { validateCapabilityRegistry } from "./capabilities/registry.js";
import { registerPrompts } from "./prompts.js";

import {
  pagesInput,
  mediaInput,
  sharedInput,
  configInput,
  siteInput,
  themeInput,
  docsInput,
} from "./schemas.js";
import { handlePages } from "./domains/pages.js";
import { handleMedia } from "./domains/media.js";
import { handleShared } from "./domains/shared.js";
import { handleConfig } from "./domains/config.js";
import { handleSite } from "./domains/site.js";
import { handleTheme } from "./domains/theme.js";
import { handleDocs } from "./domains/docs.js";

export const SERVER_NAME = "automad-mcp";
export const SERVER_VERSION = "0.5.0";

export interface ServerDeps {
  client: HttpClient;
  guard: WriteGuard;
  /** Optional when `automad_theme` is unused; required for theme tooling. */
  config: Config;
}

/**
 * Automad v2 MCP bridge. Each tool takes an `action` parameter and dispatches
 * to a domain router against the real `/_api/{controller}/{method}` contract.
 *
 * Tools:
 *   pages  (list/get/create/update/delete/move/duplicate)
 *   media  (list/upload)
 *   shared (get/set — site-wide data; replaces v1 snippets/templates)
 *   config (get from bootstrap, set via /_api/config/update)
 *   site   (info from bootstrap, search via /_api/search/search-replace)
 *   theme  (list/install/activate/uninstall/scaffold/build/read/write/files —
 *           local-FS theme tooling, requires AUTOMAD_THEMES_PATH)
 *
 * Resources:
 *   automad://themes
 *   automad://themes/{slug}/schema
 *
 * Destructive actions return a confirmToken; replay the call with
 * `confirm_token` to execute.
 */
export function createAutomadServer(deps: ServerDeps): McpServer {
  validateCapabilityRegistry();
  const { client, guard, config } = deps;
  const themeDeps = config.themesPath
    ? { client, guard, themesPath: config.themesPath, starterKitPath: config.starterKitPath ?? config.themesPath }
    : undefined;
  const themeResourceDeps = { themesPath: config.themesPath };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { resources: { listChanged: false }, tools: { listChanged: false }, prompts: { listChanged: false } } },
  );

  const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      const data = await fn();
      return {
        content: [
          { type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) },
        ],
      };
    } catch (err: unknown) {
      const serialized = errorToJson(err);
      logger.warn({ err: serialized }, "tool call failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(serialized) }],
        isError: true,
      };
    }
  };

  const liveGate = (): void => {
    if (!config.liveEnabled) {
      throw new AutomadMcpError(
        "UNSUPPORTED",
        "Live API tools are disabled (AUTOMAD_MODE=docs or missing credentials). Set AUTOMAD_MODE=full with AUTOMAD_URL/AUTOMAD_USER/AUTOMAD_PASS to enable them.",
      );
    }
  };

  server.registerTool(
    "automad_pages",
    {
      title: "Pages",
      description: "Manage Automad v2 pages: list, get, create, update, delete, move, duplicate. Uses /_api/page/* and /_api/public/pagelist.",
      inputSchema: pagesInput,
    },
    (input) => run(() => { liveGate(); return handlePages(input, client, guard); }),
  );

  server.registerTool(
    "automad_media",
    {
      title: "Media",
      description: "Manage Automad v2 media: list files for a page/shared directory, upload (single-chunk). Uses /_api/file-collection/*.",
      inputSchema: mediaInput,
    },
    (input) => run(() => { liveGate(); return handleMedia(input, client, guard); }),
  );

  server.registerTool(
    "automad_shared",
    {
      title: "Shared data",
      description: "Site-wide shared data (sitename, consent, custom fields): get and set. Uses /_api/shared/data.",
      inputSchema: sharedInput,
    },
    (input) => run(() => { liveGate(); return handleShared(input, client, guard); }),
  );

  server.registerTool(
    "automad_config",
    {
      title: "Config",
      description: "Site config: `get` returns envKeys/sitename/version from /_api/app/bootstrap; `set` posts to /_api/config/update with a type discriminator (cache, feed, debug, etc.).",
      inputSchema: configInput,
    },
    (input) => run(() => { liveGate(); return handleConfig(input, client, guard); }),
  );

  server.registerTool(
    "automad_site",
    {
      title: "Site",
      description: "Site-level: `info` returns bootstrap data; `search` queries /_api/search/search-replace (read-only when `replace` is omitted).",
      inputSchema: siteInput,
    },
    (input) => run(() => { liveGate(); return handleSite(input, client, guard); }),
  );

  server.registerTool(
    "automad_theme",
    {
      title: "Theme",
      description: "Local-filesystem theme tooling (requires AUTOMAD_THEMES_PATH). " +
        "list/install/activate/uninstall/scaffold/build, plus read/write/files for theme files (theme.json, .php, blocks/, .ts). " +
        "Scaffold copies the starter kit into a new theme dir; build runs `npm install` + `npm run build`.",
      inputSchema: themeInput,
    },
    (input) =>
      run(() => {
        if (!themeDeps) {
          throw new AutomadMcpError(
            "UNSUPPORTED",
            "automad_theme is disabled: set AUTOMAD_THEMES_PATH (and optionally AUTOMAD_STARTER_KIT_PATH) to enable it.",
          );
        }
        return handleTheme(input, themeDeps);
      }),
  );

  server.registerTool(
    "automad_docs",
    {
      title: "Docs",
      description: "Offline Automad v2 knowledge base: `list` pages, `search` by query, `get` a page by slug. " +
        "Works without a live instance (also in AUTOMAD_MODE=docs). Covers template syntax, control structures, " +
        "navigation, i18n, blocks, theme.json, headless/REST API, and getting started.",
      inputSchema: docsInput,
    },
    (input) => run(() => handleDocs(input, guard)),
  );

  server.registerResource(
    "themes",
    "automad://themes",
    { title: "Themes", description: "List of discovered themes" },
    async () => {
      const list = await readThemesList(themeResourceDeps);
      return {
        contents: [
          {
            uri: "automad://themes",
            mimeType: "application/json",
            text: JSON.stringify(list),
          },
        ],
      };
    },
  );

  server.registerResource(
    "theme-schema",
    new ResourceTemplate("automad://themes/{slug}/schema", { list: undefined }),
    { title: "Theme schema", description: "Normalized theme schema" },
    async (_uri, variables) => {
      const slug = typeof variables.slug === "string" ? variables.slug : "";
      const data = await readThemeSchema(themeResourceDeps, slug);
      return {
        contents: [
          {
            uri: `automad://themes/${slug}/schema`,
            mimeType: "application/json",
            text: JSON.stringify(data),
          },
        ],
      };
    },
  );

  server.registerResource(
    "docs",
    "automad://docs",
    { title: "Docs", description: "Automad v2 knowledge base index" },
    () => ({
      contents: [
        {
          uri: "automad://docs",
          mimeType: "application/json",
          text: JSON.stringify({ pages: listDocs() }),
        },
      ],
    }),
  );

  server.registerResource(
    "doc-page",
    new ResourceTemplate("automad://docs/{slug}", { list: undefined }),
    { title: "Doc page", description: "A single knowledge-base page (Markdown)" },
    (_uri, variables) => {
      const slug = typeof variables.slug === "string" ? variables.slug : "";
      const page = getDoc(slug);
      return {
        contents: [
          {
            uri: `automad://docs/${slug}`,
            mimeType: "text/markdown",
            text: page.body,
          },
        ],
      };
    },
  );

  registerPrompts(server);

  return server;
}
