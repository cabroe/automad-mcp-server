import { describe, expect, it, vi } from 'vitest';
import {
  TOOL_BINDINGS,
  listToolBindings,
  validateToolBindings,
  LIVE_DISABLED_MESSAGE,
  THEMES_DISABLED_MESSAGE,
  type ToolContext,
} from '../../src/capabilities/tools.js';
import { CAPABILITY_REGISTRY, getCapability, TOOL_NAMES } from '../../src/capabilities/registry.js';
import { WriteGuard } from '../../src/write-guard.js';
import type { Config } from '../../src/config.js';
import type { HttpClient } from '../../src/client.js';

function config(overrides: Partial<Config> = {}): Config {
  return {
    mode: 'full',
    url: 'https://example.test',
    username: 'u',
    password: 'p',
    writeMode: 'unrestricted',
    logLevel: 'silent',
    liveEnabled: true,
    requestTimeoutMs: 0,
    ...overrides,
  };
}

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const cfg = overrides.config ?? config();
  const client = overrides.client ?? mockClient();
  const guard = overrides.guard ?? new WriteGuard(cfg);
  return {
    client,
    guard,
    config: cfg,
    themeDeps: { client, guard, themesPath: '/tmp/themes', starterKitPath: '/tmp/starter' },
    ...overrides,
  };
}

describe('tool bindings', () => {
  it('covers every registry tool, in registry order', () => {
    expect(listToolBindings().map((binding) => binding.name)).toEqual(
      CAPABILITY_REGISTRY.map((cap) => cap.name),
    );
    expect(() => validateToolBindings()).not.toThrow();
  });

  it('gates live tools behind config.liveEnabled', async () => {
    const ctx = context({ config: config({ mode: 'docs', liveEnabled: false }) });
    for (const name of TOOL_NAMES) {
      if (getCapability(name).requires !== 'live') continue;
      await expect(TOOL_BINDINGS[name].run({ action: 'list' }, ctx)).rejects.toMatchObject({
        code: 'UNSUPPORTED',
        message: LIVE_DISABLED_MESSAGE,
      });
    }
  });

  it('gates theme tooling behind a configured themes path', async () => {
    const ctx = context({ themeDeps: undefined });
    await expect(TOOL_BINDINGS.automad_theme.run({ action: 'list' }, ctx)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: THEMES_DISABLED_MESSAGE,
    });
  });

  it('runs ungated tools in docs mode', async () => {
    const ctx = context({ config: config({ mode: 'docs', liveEnabled: false }) });
    const docs = await TOOL_BINDINGS.automad_docs.run({ action: 'list' }, ctx);
    expect(docs).toMatchObject({ pages: expect.any(Array) });
    const discover = (await TOOL_BINDINGS.automad_discover.run({ action: 'list' }, ctx)) as {
      capabilities: unknown[];
    };
    expect(discover.capabilities.length).toBeGreaterThan(30);
  });

  it("validates input against the tool's own schema before dispatch", async () => {
    const ctx = context();
    await expect(TOOL_BINDINGS.automad_docs.run({ action: 'nope' }, ctx)).rejects.toThrow();
  });

  it('dispatches to the domain router with the parsed input', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValue({ sitename: 'Example' });
    const ctx = context({ client });
    await TOOL_BINDINGS.automad_site.run({ action: 'info' }, ctx);
    expect(client.get).toHaveBeenCalled();
  });
});
