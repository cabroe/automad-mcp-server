import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAutomadServer } from '../../src/server.js';
import { WriteGuard } from '../../src/write-guard.js';
import type { HttpClient } from '../../src/client.js';
import type { Config } from '../../src/config.js';
import {
  CAPABILITY_REGISTRY,
  callableActions,
  getCapability,
} from '../../src/capabilities/registry.js';

const TOOL_NAMES = [
  'automad_config',
  'automad_discover',
  'automad_docs',
  'automad_media',
  'automad_pages',
  'automad_shared',
  'automad_site',
  'automad_theme',
] as const;

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(): Config {
  return {
    mode: 'full',
    url: 'https://x',
    username: 'u',
    password: 'p',
    writeMode: 'unrestricted',
    logLevel: 'error',
    liveEnabled: true,
    themesPath: '/tmp/themes-x',
    starterKitPath: '/tmp/starter-x',
  };
}

async function connect(client: HttpClient, guard: WriteGuard, config = cfg()) {
  const server = createAutomadServer({ client, guard, config });
  const mcp = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  const [t1, t2] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(t1), mcp.connect(t2)]);
  return { server, mcp };
}

describe('createAutomadServer (v2)', () => {
  it('registers the eight tools (5 v2 API + theme + docs + discover)', async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const list = await mcp.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await mcp.close();
    await server.close();
  });

  it('reports the version from package.json (no manual drift)', async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const info = mcp.getServerVersion();
    expect(info?.name).toBe('automad-mcp');
    // Must match the value in package.json — no separate const that can drift.
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    expect(info?.version).toBe((pkg as { default: { version: string } }).default.version);
    await mcp.close();
    await server.close();
  });

  it('every registered tool exposes an action enum', async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const list = await mcp.listTools();
    for (const t of list.tools) {
      const actionEnum = (t.inputSchema as { properties?: { action?: { enum?: string[] } } })
        ?.properties?.action?.enum;
      expect(Array.isArray(actionEnum) && actionEnum.length > 0).toBe(true);
    }
    await mcp.close();
    await server.close();
  });

  it('handler errors are surfaced as isError results, not thrown', async () => {
    const boom = (): HttpClient => {
      const c = mockClient();
      (c.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      return c;
    };
    const { server, mcp } = await connect(boom(), new WriteGuard(cfg()));
    const result = await mcp.callTool({ name: 'automad_site', arguments: { action: 'info' } });
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.message).toMatch(/boom/);
    await mcp.close();
    await server.close();
  });

  it('advertises read-only theme resources and keeps the existing tools', async () => {
    const { mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const templates = await mcp.listResourceTemplates();
    expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      'automad://themes/{slug}/schema',
      'automad://docs/{slug}',
    ]);
    const resources = await mcp.listResources();
    expect(resources.resources).toEqual([
      {
        uri: 'automad://themes',
        name: 'themes',
        title: 'Themes',
        description: 'List of discovered themes',
      },
      {
        uri: 'automad://docs',
        name: 'docs',
        title: 'Docs',
        description: 'Automad v2 knowledge base index',
      },
    ]);
    const toolNames = (await mcp.listTools()).tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual([...TOOL_NAMES].sort());
    await mcp.close();
  });

  it('registers workflow prompts and renders them with arguments', async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const names = (await mcp.listPrompts()).prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      'analyze_theme',
      'check_headless_setup',
      'create_blog_post',
      'find_docs',
      'scaffold_theme',
    ]);

    const post = await mcp.getPrompt({
      name: 'create_blog_post',
      arguments: { title: 'Hello World', parent: '/blog' },
    });
    const postContent = post.messages[0]!.content;
    expect(postContent.type).toBe('text');
    if (postContent.type === 'text') {
      expect(postContent.text).toContain('Hello World');
      expect(postContent.text).toContain('/blog');
    }

    const noArgs = await mcp.getPrompt({ name: 'check_headless_setup', arguments: {} });
    const noArgsContent = noArgs.messages[0]!.content;
    if (noArgsContent.type === 'text') {
      expect(noArgsContent.text).toContain('health');
      expect(noArgsContent.text).toContain('headless-api');
    }
    await mcp.close();
    await server.close();
  });

  it("takes every tool's title and description from the capability registry", async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const list = await mcp.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(CAPABILITY_REGISTRY.map((cap) => cap.name));
    for (const tool of list.tools) {
      const capability = getCapability(tool.name);
      expect(tool.title).toBe(capability.title);
      expect(tool.description).toBe(capability.description);
    }
    await mcp.close();
    await server.close();
  });

  it("gates live-API tools in docs mode, per the registry's `requires`", async () => {
    const docsConfig: Config = { ...cfg(), mode: 'docs', liveEnabled: false };
    const { server, mcp } = await connect(mockClient(), new WriteGuard(docsConfig), docsConfig);
    for (const capability of CAPABILITY_REGISTRY) {
      if (capability.requires !== 'live') continue;
      const [action] = callableActions(capability)[0]!;
      const result = await mcp.callTool({ name: capability.name, arguments: { action } });
      expect(result.isError, capability.name).toBe(true);
      const payload = JSON.parse((result.content as [{ text: string }])[0].text);
      expect(payload.code).toBe('UNSUPPORTED');
    }
    await mcp.close();
    await server.close();
  });

  it('automad_discover works even when live-API tools are disabled (docs mode)', async () => {
    const docsConfig: Config = { ...cfg(), mode: 'docs', liveEnabled: false };
    const { server, mcp } = await connect(mockClient(), new WriteGuard(docsConfig), docsConfig);

    const list = await mcp.callTool({ name: 'automad_discover', arguments: { action: 'list' } });
    expect(list.isError).toBeFalsy();
    const listPayload = JSON.parse((list.content as [{ text: string }])[0].text);
    expect(listPayload.capabilities.length).toBeGreaterThan(30);

    const described = await mcp.callTool({
      name: 'automad_discover',
      arguments: { action: 'describe', tool: 'automad_pages', target_action: 'delete' },
    });
    const describedPayload = JSON.parse((described.content as [{ text: string }])[0].text);
    expect(describedPayload.tool).toBe('automad_pages');
    expect(Object.keys(describedPayload.actions)).toEqual(['delete']);
    expect(describedPayload.inputSchema.properties.action).toBeDefined();

    await mcp.close();
    await server.close();
  });
});
