import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HttpClient } from "./client.js";
import type { WriteGuard } from "./write-guard.js";
import { errorToJson } from "./errors.js";
import { logger } from "./logger.js";

import {
  pagesInput,
  mediaInput,
  sharedInput,
  configInput,
  siteInput,
} from "./schemas.js";
import { handlePages } from "./domains/pages.js";
import { handleMedia } from "./domains/media.js";
import { handleShared } from "./domains/shared.js";
import { handleConfig } from "./domains/config.js";
import { handleSite } from "./domains/site.js";

export const SERVER_NAME = "automad-mcp";
export const SERVER_VERSION = "0.2.0";

export interface ServerDeps {
  client: HttpClient;
  guard: WriteGuard;
}

/**
 * Automad v2 MCP bridge. Each tool takes an `action` parameter and dispatches
 * to a domain router against the real `/_api/{controller}/{method}` contract.
 *
 * Tools reflect what v2 actually exposes:
 *   pages (list/get/create/update/delete/move/duplicate),
 *   media (list/upload),
 *   shared (get/set — site-wide data; replaces v1 snippets/templates),
 *   config (get from bootstrap, set via /_api/config/update),
 *   site  (info from bootstrap, search via /_api/search/search-replace).
 *
 * Destructive actions return a confirmToken; replay the call with
 * `confirm_token` to execute.
 */
export function createAutomadServer(deps: ServerDeps): McpServer {
  const { client, guard } = deps;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Automad v2 MCP bridge (serves only Automad v2, https://automad.org/version-2). " +
        "Each tool takes an `action` parameter and talks to the v2 /_api JSON dispatch layer " +
        "via session-cookie + CSRF authentication. Destructive actions return a confirmToken; " +
        "replay the call with `confirm_token` to execute.",
    },
  );

  const run = (fn: () => Promise<unknown>): Promise<CallToolResult> =>
    fn()
      .then((data) => ({
        content: [
          { type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) },
        ],
      }))
      .catch((err: unknown) => {
        const serialized = errorToJson(err);
        logger.warn({ err: serialized }, "tool call failed");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(serialized) }],
          isError: true,
        };
      });

  server.registerTool(
    "automad_pages",
    {
      title: "Pages",
      description: "Manage Automad v2 pages: list, get, create, update, delete, move, duplicate. Uses /_api/page/* and /_api/public/pagelist.",
      inputSchema: pagesInput,
    },
    (input) => run(() => handlePages(input, client, guard)),
  );

  server.registerTool(
    "automad_media",
    {
      title: "Media",
      description: "Manage Automad v2 media: list files for a page/shared directory, upload (single-chunk). Uses /_api/file-collection/*.",
      inputSchema: mediaInput,
    },
    (input) => run(() => handleMedia(input, client, guard)),
  );

  server.registerTool(
    "automad_shared",
    {
      title: "Shared data",
      description: "Site-wide shared data (sitename, consent, custom fields): get and set. Uses /_api/shared/data.",
      inputSchema: sharedInput,
    },
    (input) => run(() => handleShared(input, client, guard)),
  );

  server.registerTool(
    "automad_config",
    {
      title: "Config",
      description: "Site config: `get` returns envKeys/sitename/version from /_api/app/bootstrap; `set` posts to /_api/config/update with a type discriminator (cache, feed, debug, etc.).",
      inputSchema: configInput,
    },
    (input) => run(() => handleConfig(input, client, guard)),
  );

  server.registerTool(
    "automad_site",
    {
      title: "Site",
      description: "Site-level: `info` returns bootstrap data; `search` queries /_api/search/search-replace (read-only when `replace` is omitted).",
      inputSchema: siteInput,
    },
    (input) => run(() => handleSite(input, client, guard)),
  );

  return server;
}
