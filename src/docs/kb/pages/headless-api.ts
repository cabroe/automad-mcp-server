import type { DocPage } from '../../kb.js';

export const page: DocPage = {
  slug: 'headless',
  title: 'Headless / REST API',
  tags: ['headless', 'rest', 'api', 'json', 'endpoints', 'csrf', 'session'],
  reference: 'https://automad.org/headless-mode',
  body: `# Headless / REST API

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
`,
};
