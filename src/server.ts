import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readThemesList, readThemeSchema } from './resources/themes.js';
import { getDoc, listDocs } from './docs/kb.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { HttpClient } from './client.js';
import type { WriteGuard } from './write-guard.js';
import type { Config } from './config.js';
import { errorToJson } from './errors.js';
import { logger } from './logger.js';
import { getCapability, validateCapabilityRegistry } from './capabilities/registry.js';
import { listToolBindings, validateToolBindings, type ToolContext } from './capabilities/tools.js';
import { registerPrompts } from './prompts.js';
import pkg from '../package.json' with { type: 'json' };
const SERVER_VERSION: string = pkg.version;

export const SERVER_NAME = 'automad-mcp';

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
 * The tool surface itself is not spelled out here: tools are registered from
 * `capabilities/tools.ts` (schema + dispatch) with their title, description and
 * runtime gate taken from `capabilities/registry.ts` — the single source of
 * truth that also drives the write-guard, the Zod action enums, the discovery
 * facade (`automad_discover`) and the generated docs.
 *
 * Resources:
 *   automad://themes
 *   automad://themes/{slug}/schema
 *   automad://docs
 *   automad://docs/{slug}
 *
 * Destructive actions return a confirmToken; replay the call with
 * `confirm_token` to execute.
 */
export function createAutomadServer(deps: ServerDeps): McpServer {
  validateCapabilityRegistry();
  validateToolBindings();
  const { client, guard, config } = deps;
  const themeDeps = config.themesPath
    ? {
        client,
        guard,
        themesPath: config.themesPath,
        starterKitPath: config.starterKitPath ?? config.themesPath,
      }
    : undefined;
  const themeResourceDeps = { themesPath: config.themesPath };
  const toolContext: ToolContext = { client, guard, config, themeDeps };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        resources: { listChanged: false },
        tools: { listChanged: false },
        prompts: { listChanged: false },
      },
    },
  );

  const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      const data = await fn();
      return {
        content: [
          { type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data) },
        ],
      };
    } catch (err: unknown) {
      const serialized = errorToJson(err);
      logger.warn({ err: serialized }, 'tool call failed');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(serialized) }],
        isError: true,
      };
    }
  };

  for (const binding of listToolBindings()) {
    const capability = getCapability(binding.name);
    server.registerTool(
      binding.name,
      {
        title: capability.title,
        description: capability.description,
        inputSchema: binding.inputSchema,
      },
      (input: unknown) => run(() => binding.run(input, toolContext)),
    );
  }

  server.registerResource(
    'themes',
    'automad://themes',
    { title: 'Themes', description: 'List of discovered themes' },
    async () => {
      const list = await readThemesList(themeResourceDeps);
      return {
        contents: [
          {
            uri: 'automad://themes',
            mimeType: 'application/json',
            text: JSON.stringify(list),
          },
        ],
      };
    },
  );

  server.registerResource(
    'theme-schema',
    new ResourceTemplate('automad://themes/{slug}/schema', { list: undefined }),
    { title: 'Theme schema', description: 'Normalized theme schema' },
    async (_uri, variables) => {
      const slug = typeof variables.slug === 'string' ? variables.slug : '';
      const data = await readThemeSchema(themeResourceDeps, slug);
      return {
        contents: [
          {
            uri: `automad://themes/${slug}/schema`,
            mimeType: 'application/json',
            text: JSON.stringify(data),
          },
        ],
      };
    },
  );

  server.registerResource(
    'docs',
    'automad://docs',
    { title: 'Docs', description: 'Automad v2 knowledge base index' },
    () => ({
      contents: [
        {
          uri: 'automad://docs',
          mimeType: 'application/json',
          text: JSON.stringify({ pages: listDocs() }),
        },
      ],
    }),
  );

  server.registerResource(
    'doc-page',
    new ResourceTemplate('automad://docs/{slug}', { list: undefined }),
    { title: 'Doc page', description: 'A single knowledge-base page (Markdown)' },
    (_uri, variables) => {
      const slug = typeof variables.slug === 'string' ? variables.slug : '';
      const page = getDoc(slug);
      return {
        contents: [
          {
            uri: `automad://docs/${slug}`,
            mimeType: 'text/markdown',
            text: page.body,
          },
        ],
      };
    },
  );

  registerPrompts(server);

  return server;
}
