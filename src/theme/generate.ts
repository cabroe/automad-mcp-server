import { AutomadMcpError } from '../errors.js';

/**
 * Snippet / block / component generator. Produces authentic Automad v2 template
 * code for common patterns so callers don't have to scaffold a whole theme just
 * to add one file. Read-only: returns the suggested path + content; persist it
 * with `theme.write` (which can be previewed via `theme.diff`).
 */
export interface GeneratedFile {
  kind: string;
  path: string;
  content: string;
  notes: string;
}

export interface GenerateOptions {
  kind: string;
  /** Snippet/block/component identifier (used for filenames + snippet names). */
  name?: string | undefined;
  /** Override the suggested target path. */
  path?: string | undefined;
}

type Builder = (name: string) => { path: string; content: string; notes: string };

const SLUG_RE = /^[a-z0-9][a-z0-9._/-]*$/i;

const BUILDERS: Record<string, Builder> = {
  nav: buildNav,
  pagelist: buildPagelist,
  breadcrumbs: buildBreadcrumbs,
  component: buildComponent,
  block: buildBlock,
  i18n: buildI18n,
  snippet: buildSnippet,
};

export function listGeneratorKinds(): string[] {
  return Object.keys(BUILDERS);
}

export function generate(opts: GenerateOptions): GeneratedFile {
  const builder = BUILDERS[opts.kind];
  if (!builder) {
    throw new AutomadMcpError('VALIDATION', `unknown generator kind '${opts.kind}'`, {
      available: Object.keys(BUILDERS),
    });
  }
  const fallback =
    opts.kind === 'block' ? 'custom' : opts.kind === 'component' ? 'part' : opts.kind;
  const name = (opts.name ?? fallback).trim();
  if (!SLUG_RE.test(name) || name.includes('..')) {
    throw new AutomadMcpError('VALIDATION', `invalid name '${name}'`);
  }
  const built = builder(name);
  const path = normalizePath(opts.path ?? built.path);
  return { kind: opts.kind, path, content: built.content, notes: built.notes };
}

function normalizePath(p: string): string {
  const clean = p.replace(/^\/+/, '').replace(/\\/g, '/');
  if (clean.includes('..'))
    throw new AutomadMcpError('VALIDATION', `path must not contain '..': ${p}`);
  return clean;
}

function buildNav(name: string): { path: string; content: string; notes: string } {
  return {
    path: `snippets/${name}.php`,
    content: `<@ snippet ${name} @>
  <ul>
    <@ foreach in pagelist @>
      <li<@ if @{ :current } @> class="active"<@ end @>>
        <a href="@{ :url }">@{ :title }</a>
        <@ if @{ :currentPath } @>
          <@ ${name} @>
        <@ end @>
      </li>
    <@ end @>
  </ul>
<@ end @>
`,
    notes: `Recursive navigation snippet. Call it after a pagelist:\n<nav>\n  <@ newPagelist { type: 'children' } @>\n  <@ ${name} @>\n</nav>`,
  };
}

function buildPagelist(name: string): { path: string; content: string; notes: string } {
  return {
    path: `snippets/${name}.php`,
    content: `<@ newPagelist { type: 'children', sort: 'date desc' } @>
<@ foreach in pagelist @>
  <article>
    <h3><a href="@{ :url }">@{ :title }</a></h3>
    <p>@{ :teaser | def(@{ text | stripTags | shorten(200) }) }</p>
  </article>
<@ end @>
`,
    notes: 'Pagelist loop. Adjust the `type`/`sort` options as needed (children, related, all).',
  };
}

function buildBreadcrumbs(name: string): { path: string; content: string; notes: string } {
  return {
    path: `snippets/${name}.php`,
    content: `<nav class="breadcrumbs">
  <@ foreach in breadcrumbs @>
    <a href="@{ :url }">@{ :title }</a>
  <@ end @>
</nav>
`,
    notes: 'Breadcrumb trail using the breadcrumbs object.',
  };
}

function buildComponent(name: string): { path: string; content: string; notes: string } {
  return {
    path: `components/${name}.php`,
    content: `<!DOCTYPE html>
<html lang="@{ :lang | def('en') }">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>@{ title | def(@{ sitename }) }</title>
  <link href="/packages/@{ :theme }/dist/main.css" rel="stylesheet">
</head>
<body>
  <main>
    @{ +main }
  </main>
</body>
</html>
`,
    notes: `Base page component. Reference it from default.php:\n<@ components/${name}.php @>`,
  };
}

function buildBlock(name: string): { path: string; content: string; notes: string } {
  return {
    path: `blocks/${name}.php`,
    content: `<div class="block block-${name} @{ :classes }">
  @{ +main }
</div>
`,
    notes: `Custom block template. Select a variant before including:\n<@ set { :classes: 'variant-a' } @>\n<@ blocks/${name}.php @>`,
  };
}

function buildI18n(name: string): { path: string; content: string; notes: string } {
  const locale = name === 'i18n' ? 'en' : name;
  return {
    path: `i18n/${locale}.json`,
    content: `${JSON.stringify(
      {
        'nav.home': 'Home',
        'nav.products': 'Products',
        'msg.greeting': 'Hello {name}',
      },
      null,
      2,
    )}\n`,
    notes: `Translation dictionary for '${locale}'. Use in templates:\n<@ t { key: "nav.products" } @>\nKeep keys identical across every i18n/*.json file.`,
  };
}

function buildSnippet(name: string): { path: string; content: string; notes: string } {
  return {
    path: `snippets/${name}.php`,
    content: `<@ snippet ${name} @>
  <div class="${name}">
    @{ +main }
  </div>
<@ end @>
`,
    notes: `Generic reusable snippet. Call it with <@ ${name} @>.`,
  };
}
