import { AutomadMcpError } from "../errors.js";

/**
 * Bundled Automad v2 knowledge base.
 *
 * Content is embedded as string constants (not loose `.md` files) so it ships
 * in `dist/` after `tsc` with zero asset-copying step. Sourced from the
 * official Automad v2 documentation (https://automad.org). This makes the
 * docs tool work fully offline and in `AUTOMAD_MODE=docs` without any live
 * instance.
 */

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly reference: string;
  readonly body: string;
}

export interface DocSummary {
  slug: string;
  title: string;
  tags: readonly string[];
  reference: string;
}

export interface DocSearchHit {
  slug: string;
  title: string;
  score: number;
  snippet: string;
}

const TEMPLATE_SYNTAX = `# Template syntax

Automad v2 templates mix three distinct constructs. Getting them right is the
single most common source of theme bugs.

## Statements — \`<@ ... @>\`
PHP-like control structures. Always wrapped in \`<@ ... @>\`.

\`\`\`
<@ components/nav.php @>            <!-- include a component -->
<@ if @{ variable } @> ... <@ end @>
<@ foreach in pagelist @> ... <@ end @>
<@ set { :myVar: "value" } @>
<@ newPagelist { type: 'children' } @>
\`\`\`

## Variables — \`@{ ... }\`
Output a field value. **No** \`<@ @>\` wrapper.

\`\`\`
@{ title }                  <!-- a page/shared field -->
@{ :lang }                  <!-- runtime variable (leading colon) -->
@{ title | def('Untitled') }
@{ text | markdown }
@{ date | dateFormat('d. F Y') }
@{ text | stripTags | shorten(200) }
\`\`\`

## Block editor fields — \`@{ +name }\`
The leading \`+\` marks a block-editor region. No \`<@ @>\`, no spaces after \`+\`.

\`\`\`
@{ +main }
@{ +hero }
\`\`\`

Wrong: \`<@ @{ +main } @>\`, \`@{ + main }\`, \`@{+main}\`.

## Debugging checklist
- Clear the cache after template changes (Dashboard → cache, or delete \`cache/\`).
- \`<@\` not interpreted → enable \`short_open_tag = On\` in php.ini / .user.ini.
- Template not found → the file exists, is referenced in theme.json, and the
  page uses that template.
`;

const CONTROL_STRUCTURES = `# Control structures (set, with, foreach, if)

## set — mutate the current context
\`\`\`
<@ set { :classArticle: 'card', :showFooter: true } @>
<@ set { filter: '{"checkboxShowInNavbar":"/[^0]+/"}', sort: 'date desc' } @>
<@~ set { :count: 6 } ~@>    <!-- ~ strips surrounding whitespace -->
\`\`\`

## with — switch context to another page or object
\`\`\`
<@ with '/contact' @>
  <h2>@{ :title }</h2>
<@ end @>

<@ with @{ imageLogo } @>
  <img src="@{ imageLogo }" alt="@{ :basename }">
<@ end @>
\`\`\`
\`:file\`, \`:fileResized\`, \`:basename\` exist **only** inside a \`with @{ image } { }\` block.

## foreach — iterate objects (pagelist, filelist, nav, breadcrumb)
Inside \`foreach in\`, loop variables use the \`:\` prefix.
\`\`\`
<@ foreach in pagelist @>
  <article>
    <h3>@{ :title }</h3>
    <a href="@{ :url }">Read more</a>
  </article>
<@ end @>
\`\`\`

| Variable | Meaning |
|---|---|
| \`:title\` / \`:url\` / \`:date\` | current page fields |
| \`:current\` | this page **is** the requested page |
| \`:currentPath\` | this page is **on the path** to the requested page |

## if — conditional
\`\`\`
<@ if @{ variable } @> yes <@ else @> no <@ end @>
<@ foreach in pagelist @>
  <li<@ if @{ :current } @> class="active"<@ end @>>
    <a href="@{ :url }">@{ :title }</a>
  </li>
<@ end @>
\`\`\`
`;

const NAVIGATION = `# Navigation

## Helpers
\`\`\`
<@ navTree @>         <!-- full navigation tree -->
<@ breadcrumbs @>     <!-- breadcrumb trail -->
<@ newPagelist { type: 'children' } @>
\`\`\`

## Pagelist with a loop
\`\`\`
<@ newPagelist { type: 'children', sort: 'date desc' } @>
<@ foreach in pagelist @>
  <a href="@{ :url }">@{ :title }</a>
<@ end @>
\`\`\`

## Recursive menu snippet
A snippet may call itself for nested menus.
\`\`\`
<@ snippet tree @>
  <ul>
    <@ foreach in pagelist @>
      <li<@ if @{ :current } @> class="active"<@ end @>>
        <a href="@{ :url }">@{ :title }</a>
        <@ if @{ :currentPath } @>
          <@ tree @>            <!-- recurse into open branch -->
        <@ end @>
      </li>
    <@ end @>
  </ul>
<@ end @>

<nav>
  <@ newPagelist { type: 'children' } @>
  <@ tree @>
</nav>
\`\`\`

\`:current\` = "this is the current page"; \`:currentPath\` = "this page is on the
way to the current page" (keeps the branch open).
`;

const I18N = `# Multilingual (i18n)

Translation dictionaries live in \`i18n/<locale>.json\` inside the theme.

## Output a translation
\`\`\`
<@ t { key: "nav.products" } @>
<@ t { key: "msg.text", name: "Max" } @>   <!-- placeholder: 'Hallo {name}' -->
\`\`\`

## Language switch link
\`\`\`
<@ langSwitchLink @>
\`\`\`

## Dictionary file — i18n/de.json
\`\`\`json
{
  "nav.products": "Produkte",
  "msg.text": "Hallo {name}"
}
\`\`\`

Keep the key set identical across every \`i18n/*.json\` file — missing keys in one
locale fall back to the key string. \`automad_theme.validate\` flags empty i18n
directories and duplicate locales.
`;

const BLOCKS = `# Blocks

Content is authored in the block editor and rendered where a template places a
\`@{ +field }\` region.

## Core blocks (v2)

| Type | Renders | Key properties |
|---|---|---|
| \`paragraph\` | Rich text (paragraphs, inline marks, links) | — |
| \`header\` | Heading (levels 1–6) | level |
| \`image\` | Single image with optional caption/link | \`url\`, \`alt\`, \`caption\`, \`link\` |
| \`image-slideshow\` | Carousel of images with autoplay/effects | \`files\`, \`loop\`, \`autoplay\`, \`effect\`, \`delay\`, \`breakpoints\` |
| \`gallery\` | Grid of images (see \`blocks/gallery/*.php\` for variants) | — |
| \`video\` | Native HTML5 video | \`url\`, \`caption\` |
| \`embed\` | oEmbed (YouTube, Vimeo, etc.) | \`service\`, \`embed\`, \`width\`, \`height\`, \`caption\` |
| \`filelist\` | List of files in a directory (see templates under \`blocks/filelist/\`) | — |
| \`code\` | Syntax-highlighted code block | language |
| \`quote\` | Blockquote with optional attribution | — |
| \`callout\` | Highlighted info/warn/success box | style |
| \`delimiter\` | Horizontal separator | — |
| \`buttons\` | Row of buttons | \`justify\`, \`gap\` |
| \`mail\` | Mailto link / contact card | \`to\` |
| \`layout-section\` | Full-width container for grouping blocks (with style + flex controls) | \`content\`, \`style\`, \`gap\`, \`justify\`, \`align\` |
| \`nested-list\` | Bulleted/numbered list (nested) | — |
| \`table\` | Tabular data (rows/cols) | \`content\` |
| \`table-of-contents\` | Auto-generated ToC from headings | — |
| \`pagelist\` | List of child pages, tag pages, or search results | \`context\` (children/tags/search), \`filter\`, \`limit\`, \`offset\`, \`template\`, \`type\`, \`file\` |
| \`snippet\` | Include another template (file or named snippet) | \`snippet\`, \`file\` |
| \`component\` | Render a registered component by name | — |
| \`collapsible-section\` | Expandable content block (accordion-style) | \`title\`, \`collapsed\`, \`group\`, \`content\` |
| \`raw\` | Raw HTML (sanitized on output) | html |
| \`tex\` | LaTeX/math expression (rendered via KaTeX/MathJax by the frontend) | formula |

(Source: \`automad/automad:v2\` \`/app/automad/src/server/Blocks/*.php\` — verified live.)

## Rendering blocks

\`\`\`
<div class="content">
  @{ +main }
</div>
\`\`\`

## Declaring block fields in theme.json

\`\`\`json
{
  "masks": { "page": ["+main"], "shared": [] },
  "fieldOrder": ["+main"],
  "tooltips": { "+main": "Main content area" }
}
\`\`\`

## Customizing block markup

Per-block templates live under \`blocks/<type>/*.php\` (e.g. \`blocks/pagelist/blog.php\`)
and receive the current context. Set variant classes with \`set\` before including:

\`\`\`
<@ set { :classes: 'cards masonry' } @>
<@ blocks/pagelist/blog.php @>
\`\`\`

## Per-block templates (Starter Kit)

The Automad Theme Starter Kit ships example templates you can copy and adapt:

\`\`\`
blocks/
  pagelist/
    grid.php        # default grid layout for the pagelist block
\`\`\`

Add a new variant by creating \`blocks/<type>/<variant>.php\` in your theme; the
dashboard lets the editor pick the variant per block instance.
`;

const THEME_JSON = `# theme.json

The manifest that describes a theme to the dashboard.

\`\`\`json
{
  "name": "My Theme",
  "version": "1.0.0",
  "author": "Jane Doe",
  "license": "MIT",
  "description": "A clean blog theme",
  "masks": { "page": ["+main"], "shared": ["sitename", "+footer"] },
  "fieldOrder": ["title", "+main"],
  "labels": { "title": "Page title" },
  "tooltips": { "+main": "Main content area" },
  "options": {
    "selectTheme": { "light": "Light", "dark": "Dark" }
  }
}
\`\`\`

| Key | Purpose |
|---|---|
| \`masks\` | which fields appear in the page vs. shared data editor |
| \`fieldOrder\` | order of fields in the dashboard |
| \`labels\` | human-readable field labels |
| \`tooltips\` | help text per field |
| \`options\` | select/choice widgets: field → {value: label} |

Field names referenced in templates via \`@{ field }\` should be surfaced through
\`masks\`/\`fieldOrder\` so editors can fill them. Run \`automad_theme.schema\` to get
a normalized view of every field a theme uses.
`;

const HEADLESS_API = `# Headless / REST API

Automad v2 exposes a JSON dispatch layer at \`/_api/{controller}/{method}\`. The
same layer powers the dashboard and this MCP server.

## Auth (no bearer tokens in v2)
1. \`POST /_api/session/login\` (urlencoded \`name-or-email\` + \`password\`) — sets a
   PHP session cookie \`Automad-<md5>\`. CSRF-exempt.
2. Every authenticated \`POST\` includes a \`__csrf__\` field. The token lives in the
   dashboard HTML: \`<meta name="csrf" content="...">\`.

## Useful endpoints
| Endpoint | Purpose |
|---|---|
| \`/_api/page/data\` | read (published) / save a page |
| \`/_api/page/add\` | create a draft |
| \`/_api/page/publish\` | publish a draft (also performs renames) |
| \`/_api/page/delete\` | delete a page |
| \`/_api/public/pagelist\` | public page list |
| \`/_api/shared/data\` | site-wide shared data |
| \`/_api/app/bootstrap\` | site info (sitename, version, envKeys) |
| \`/_api/search/search-replace\` | search / search-replace |
| \`/_api/file-collection/list\` | media listing |

Drafts are not readable via \`page/data\` until published — create/save, then
publish, then read.

## Rendered pages as JSON
Append the JSON view to a page URL (or use the block \`@{ ... }\` output) to consume
content headlessly; for structured content prefer the \`/_api\` endpoints above.
`;

const GETTING_STARTED = `# Getting started

## Docker (fastest)
\`\`\`
docker run -dp 8080:80 automad/automad:v2
\`\`\`
Open http://localhost:8080/dashboard and create the first user.

## Requirements
- PHP with \`short_open_tag = On\`
- Write access to the site directory (pages, cache, packages)

## Installing themes/packages
Themes live under \`packages/<vendor>/<name>\`. Install from the dashboard
(Packages) or drop a theme directory into \`packages/\`. With this MCP server, use
\`automad_theme\` (scaffold/install/build/activate) against \`AUTOMAD_THEMES_PATH\`.

## Minimal theme
\`\`\`
packages/my/theme/
  theme.json        # { "name": "My Theme", "masks": { "shared": ["+main"] } }
  default.php       # <@ components/page.php @>
  components/page.php
\`\`\`
\`\`\`php
<!-- components/page.php -->
<!DOCTYPE html>
<html lang="@{ :lang | def('en') }">
  <body>@{ +main }</body>
</html>
\`\`\`
`;

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: "template-syntax",
    title: "Template syntax",
    tags: ["template", "syntax", "statements", "variables", "blocks", "pipe"],
    reference: "https://automad.org/developer-guide/building-themes/template-language",
    body: TEMPLATE_SYNTAX,
  },
  {
    slug: "control-structures",
    title: "Control structures (set, with, foreach, if)",
    tags: ["foreach", "if", "with", "set", "loop", "context"],
    reference: "https://automad.org/developer-guide/building-themes/template-language/control-structures",
    body: CONTROL_STRUCTURES,
  },
  {
    slug: "navigation",
    title: "Navigation",
    tags: ["nav", "navtree", "breadcrumbs", "pagelist", "menu", "recursive"],
    reference: "https://automad.org/developer-guide/building-themes/template-language/recursive-navigations",
    body: NAVIGATION,
  },
  {
    slug: "i18n",
    title: "Multilingual (i18n)",
    tags: ["i18n", "multilingual", "translation", "locale", "language"],
    reference: "https://automad.org/developer-guide/building-themes/template-language/multilingual-content",
    body: I18N,
  },
  {
    slug: "blocks",
    title: "Blocks",
    tags: ["blocks", "editor", "pagelist", "section", "columns", "content"],
    reference: "https://automad.org/user-guide/using-blocks",
    body: BLOCKS,
  },
  {
    slug: "theme-json",
    title: "theme.json",
    tags: ["theme.json", "manifest", "masks", "fieldorder", "tooltips", "options"],
    reference: "https://automad.org/developer-guide/building-themes/theme-json",
    body: THEME_JSON,
  },
  {
    slug: "headless",
    title: "Headless / REST API",
    tags: ["headless", "rest", "api", "json", "endpoints", "csrf", "session"],
    reference: "https://automad.org/headless-mode",
    body: HEADLESS_API,
  },
  {
    slug: "getting-started",
    title: "Getting started",
    tags: ["install", "docker", "packages", "setup", "requirements"],
    reference: "https://automad.org/getting-started",
    body: GETTING_STARTED,
  },
];

const BY_SLUG: ReadonlyMap<string, DocPage> = new Map(DOC_PAGES.map((page) => [page.slug, page]));

export function listDocs(): DocSummary[] {
  return DOC_PAGES.map(({ slug, title, tags, reference }) => ({ slug, title, tags, reference }));
}

export function getDoc(slug: string): DocPage {
  const page = BY_SLUG.get(slug);
  if (!page) {
    throw new AutomadMcpError("NOT_FOUND", `unknown doc page '${slug}'`, { available: [...BY_SLUG.keys()] });
  }
  return page;
}

const DEFAULT_LIMIT = 5;

export function searchDocs(query: string, limit = DEFAULT_LIMIT): DocSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    throw new AutomadMcpError("VALIDATION", "query must not be empty");
  }
  const hits: DocSearchHit[] = [];
  for (const page of DOC_PAGES) {
    const title = page.title.toLowerCase();
    const tags = page.tags.join(" ").toLowerCase();
    const body = page.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      if (tags.includes(term)) score += 3;
      score += countOccurrences(body, term);
    }
    if (score > 0) {
      hits.push({ slug: page.slug, title: page.title, score, snippet: buildSnippet(page.body, terms) });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return hits.slice(0, Math.max(1, limit));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function buildSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - 60);
  const end = Math.min(body.length, at + 140);
  const raw = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${end < body.length ? "…" : ""}`;
}
