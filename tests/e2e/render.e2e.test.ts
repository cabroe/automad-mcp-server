import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import {
  Cleanup,
  MOUNTED_THEMES_PATH,
  MOUNTED_THEMES_VENDOR,
  asRecord,
  e2eEnabled,
  fetchPublicUntil,
  startServer,
  stringField,
  uniqueName,
  type E2eServer,
} from './harness.js';

/**
 * The actual job this server exists for: build a theme for a customer and run
 * their site with it. Every other suite stops at the API boundary — this one
 * checks what a *visitor* gets served, which is the only assertion that proves
 * the theme, the template binding and the content survived the round trip.
 *
 * It runs against the themes directory `docker-compose.e2e.yml` mounts into the
 * container, so the theme the MCP writes is the theme v2 renders.
 */
describe.skipIf(!e2eEnabled)('e2e: customer theme renders on the live site', () => {
  let server: E2eServer;
  const cleanup = new Cleanup();
  let slug = '';
  let template = '';
  let pageUrl = '';

  const MARKER = 'MCP-BUILT-THEME';

  /** v2 caches rendered pages; clear it so a fetch reflects the last write. */
  async function publish(): Promise<void> {
    await server.call('automad_config', { action: 'cache_clear' });
  }

  /**
   * Assert the visitor got our theme — and say why not when they did not.
   *
   * The overwhelmingly likely cause of a failure here is an instance without
   * the themes bind mount (`docker-compose.e2e.yml` maps `automad-themes/` to
   * `/app/packages/mcp`). Bare `expected 500 to be 200` sends the reader
   * hunting through the MCP for a bug that is not there, so name the
   * prerequisite instead.
   */
  function expectRenderedByOurTheme(status: number, html: string): void {
    if (status !== 200 && /Template missing/i.test(html)) {
      throw new Error(
        `Automad answered ${status} "Template missing!" for a page bound to \`${template}\`. ` +
          `The instance cannot see the theme: it needs ${MOUNTED_THEMES_PATH} mounted at ` +
          `/app/packages/${MOUNTED_THEMES_VENDOR}, which docker-compose.e2e.yml does and a ` +
          `plain \`docker run\` does not. Start the stack with \`npm run e2e:up\`.`,
      );
    }
    expect(status).toBe(200);
    expect(html).toContain(`${MARKER}: ${slug}`);
  }

  beforeAll(async () => {
    server = await startServer({
      writeMode: 'unrestricted',
      themesPath: MOUNTED_THEMES_PATH,
    });

    const scaffolded = asRecord(
      await server.callOk('automad_theme', {
        action: 'scaffold',
        name: uniqueName('E2E Customer'),
        author: 'E2E Suite',
      }),
    );
    const target = stringField(scaffolded, 'path');
    slug = path.basename(target);
    template = `${MOUNTED_THEMES_VENDOR}/${slug}/kunde`;
    cleanup.add(`remove theme ${slug}`, async () => {
      rmSync(path.join(MOUNTED_THEMES_PATH, slug), { recursive: true, force: true });
    });

    await server.callOk('automad_theme', {
      action: 'write',
      theme: slug,
      path: 'kunde.php',
      content: [
        '<!DOCTYPE html>',
        '<html lang="de"><head><meta charset="utf-8"><title>@{ title }</title></head>',
        '<body>',
        `  <!-- ${MARKER}: ${slug} -->`,
        '  <h1>@{ title }</h1>',
        '  <div class="intro">@{ intro }</div>',
        '</body></html>',
        '',
      ].join('\n'),
    });
  }, 120_000);

  afterAll(async () => {
    await cleanup.run();
    await server?.close();
  });

  it('serves a page bound to the scaffolded theme', async () => {
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('Kundenseite'),
        target_url: '/',
        template,
      }),
    );
    pageUrl = stringField(created, 'url');
    cleanup.addPage(server, pageUrl);
    await publish();

    const { status, html } = await fetchPublicUntil(pageUrl, (page) =>
      page.includes(`${MARKER}: ${slug}`),
    );
    expectRenderedByOurTheme(status, html);
  });

  it('keeps the template binding when only content fields are updated', async () => {
    // Regression guard: v2's save is a full replace, and a save without
    // `theme_template` resets the page to the site default with an empty
    // template name — after which the public URL answers 500 "Template
    // missing!". `pages.update` must carry the stored selection forward.
    const intro = `Gebaut vom MCP am ${new Date().toISOString()}`;
    await server.callOk('automad_pages', {
      action: 'update',
      url: pageUrl,
      fields: { intro },
    });
    await publish();

    const { status, html } = await fetchPublicUntil(pageUrl, (page) => page.includes(intro));
    expectRenderedByOurTheme(status, html);
    expect(html).toContain(intro);
  });

  it('reports the template through the API in the id form the caller passed', async () => {
    const page = asRecord(await server.callOk('automad_pages', { action: 'get', url: pageUrl }));
    // v2 answers with the resolved absolute path; the important part is that it
    // still points at our theme rather than the site default.
    expect(String(page['template'])).toContain(`${MOUNTED_THEMES_VENDOR}/${slug}/kunde.php`);
  });

  it('survives a rename with the theme binding intact', async () => {
    const renamed = uniqueName('Kundenseite neu');
    const updated = asRecord(
      await server.callOk('automad_pages', { action: 'update', url: pageUrl, title: renamed }),
    );
    const newUrl = stringField(updated, 'url');
    cleanup.addPage(server, newUrl);
    pageUrl = newUrl;
    await publish();

    const { status, html } = await fetchPublicUntil(newUrl, (page) => page.includes(renamed));
    expectRenderedByOurTheme(status, html);
    expect(html).toContain(renamed);
  });
});
