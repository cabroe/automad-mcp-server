import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HttpClient } from "./client.js";
import type { WriteGuard } from "./write-guard.js";
import { errorToJson } from "./errors.js";
import { logger } from "./logger.js";

import {
  pagesInput,
  mediaInput,
  snippetsInput,
  templatesInput,
  configInput,
  themeInput,
  siteInput,
} from "./schemas.js";
import { handlePages } from "./domains/pages.js";
import { handleMedia } from "./domains/media.js";
import { handleSnippets } from "./domains/snippets.js";
import { handleTemplates } from "./domains/templates.js";
import { handleConfig } from "./domains/config.js";
import { handleTheme } from "./domains/theme.js";
import { handleSite } from "./domains/site.js";

export const SERVER_NAME = "automad-mcp";
export const SERVER_VERSION = "0.1.0";

export interface ServerDeps {
  client: HttpClient;
  guard: WriteGuard;
}

/**
 * Creates an MCP server and registers the seven Automad domain tools.
 * Each tool delegates to its domain router; results are returned as JSON
 * text content. `AutomadMcpError`s are surfaced as structured `isError`
 * results rather than thrown, so the host sees a meaningful payload.
 */
export function createAutomadServer(deps: ServerDeps): McpServer {
  const { client, guard } = deps;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Automad CMS bridge. Each tool takes an `action` parameter. " +
        "Destructive actions return a confirmToken; replay the call with " +
        "`confirm_token` to execute.",
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
      description:
        "Manage Automad pages: list, get, create, update, delete, move, duplicate.",
      inputSchema: pagesInput,
    },
    (input) => run(() => handlePages(input, client, guard)),
  );

  server.registerTool(
    "automad_media",
    {
      title: "Media",
      description: "Manage Automad media: list, get, upload, delete, rename.",
      inputSchema: mediaInput,
    },
    (input) => run(() => handleMedia(input, client, guard)),
  );

  server.registerTool(
    "automad_snippets",
    {
      title: "Snippets",
      description: "Manage Automad snippets (global/local): list, get, set, delete.",
      inputSchema: snippetsInput,
    },
    (input) => run(() => handleSnippets(input, client, guard)),
  );

  server.registerTool(
    "automad_templates",
    {
      title: "Templates",
      description:
        "Manage Automad templates: list, get, set, delete, validate (syntax check).",
      inputSchema: templatesInput,
    },
    (input) => run(() => handleTemplates(input, client, guard)),
  );

  server.registerTool(
    "automad_config",
    {
      title: "Config",
      description:
        "Manage Automad site config: get (with dot-path key), set, validate.",
      inputSchema: configInput,
    },
    (input) => run(() => handleConfig(input, client, guard)),
  );

  server.registerTool(
    "automad_theme",
    {
      title: "Theme",
      description: "Manage Automad themes: list, install, activate, uninstall.",
      inputSchema: themeInput,
    },
    (input) => run(() => handleTheme(input, client, guard)),
  );

  server.registerTool(
    "automad_site",
    {
      title: "Site",
      description: "Site-level actions: info, search, backup, restore.",
      inputSchema: siteInput,
    },
    (input) => run(() => handleSite(input, client, guard)),
  );

  return server;
}

