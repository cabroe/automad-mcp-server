# Theme Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose read-only theme information as MCP Resources so clients can list themes and read normalized theme schemas without invoking `automad_theme` actions.

**Architecture:** Add a pure resource dispatcher that maps `automad://themes` and `automad://themes/{slug}/schema` to a new `listThemes` helper over `ThemeFs` and to existing `ThemeAnalyzer.analyze` plus `ThemeSchemaBuilder.build`. Register the templates through `McpServer.registerResource` after the existing tools and registry validation. No new MCP tools, no auth, no audit, no HTTP, no build, no network.

**Tech Stack:** TypeScript 5.x, Node.js 20+, MCP SDK (`@modelcontextprotocol/sdk ^1.0.0`), Zod, Vitest, existing `ThemeAnalyzer`, `ThemeSchemaBuilder`, `AutomadMcpError`, `WriteGuard`, `config`.

## Global Constraints

- `automad://themes` and `automad://themes/{slug}/schema` are read-only MCP Resources.
- `{slug}` must match `^[a-z0-9._-]+$`; any other value, including empty or with `..` or `/`, returns `NOT_FOUND`.
- Slug regex is enforced by the dispatcher before any filesystem access.
- Resources perform no HTTP, Git, npm, Composer, PHP, JavaScript, Docker, browser, or environment inspection.
- Resources perform no I/O beyond reusing the existing analyzer/builder pipelines plus the local theme listing helper.
- `McpServer.capabilities.resources = { listChanged: false }` and `tools.listChanged` remains `false`.
- Existing six public tools remain unchanged.
- No new action in the capability registry, WriteGuard, or schemas.
- Tests require no Docker, Automad instance, network, credentials, or environment variables.

---

## File Map

- Create `src/resources/themes.ts`: pure dispatcher returning JSON or throwing `AutomadMcpError("NOT_FOUND")`.
- Create `tests/unit/resources.test.ts`: payload, slug validation, server capabilities, and tool-set stability.
- Modify `src/server.ts:50-152`: switch capabilities and register both resource templates.
- Modify `tests/unit/server.test.ts`: assert `resources.listChanged === false` and the unchanged tool set.
- Modify `README.md`: document the new MCP resources and the URI scheme.

## Shared Interfaces

```ts
export interface ThemeListEntry {
  slug: string;
  name: string;
  path: string;
  manifest: { name: string; version: string; author: string };
}

export interface ThemesList {
  themesPath: string | null;
  themes: ThemeListEntry[];
}
```

`automad://themes/{slug}/schema` returns the existing `ThemeSchema` JSON.

---

### Task 1: Implement the theme resource dispatcher

**Files:**
- Create `src/resources/themes.ts`
- Create `tests/unit/resources.test.ts`

**Interfaces:**
- Produces `readThemesList` and `readThemeSchema` functions.
- No dependency on `HttpClient` or any network capability.

- [ ] **Step 1: Write failing resource tests**

Add tests:

```ts
import { readThemesList, readThemeSchema } from "../../src/resources/themes.js";
```

- `readThemesList({ themesPath: undefined })` returns `{ themesPath: null, themes: [] }`.
- `readThemesList({ themesPath })` returns themes discovered by listing `theme.json` files in direct subdirectories of `themesPath`.
- `readThemeSchema({ themesPath }, "starter")` returns the schema from `ThemeSchemaBuilder` for an existing theme.
- `readThemeSchema({ themesPath }, "../escape")` throws `NOT_FOUND`.
- `readThemeSchema({ themesPath }, "with/slash")` throws `NOT_FOUND`.
- `readThemeSchema({ themesPath }, "")` throws `NOT_FOUND`.
- `readThemeSchema({ themesPath: undefined }, "starter")` throws `NOT_FOUND`.
- `readThemeSchema({ themesPath }, "missing")` throws `NOT_FOUND`.

- [ ] **Step 2: Run focused resource tests and verify RED**

Run:

```bash
npm test -- tests/unit/resources.test.ts --reporter=dot
```

Expected: module-not-found or missing-export failures.

- [ ] **Step 3: Implement the dispatcher**

Create `src/resources/themes.ts`:

```ts
import * as path from "node:path";
import { AutomadMcpError } from "../errors.js";
import { LocalThemeFs, type ThemeFs } from "../theme/fs.js";
import { ThemeAnalyzer } from "../theme/analyzer.js";
import { ThemeSchemaBuilder } from "../theme/schema.js";

const SLUG_RE = /^[a-z0-9._-]+$/;

export interface ThemeResourceDeps {
  themesPath?: string;
  fs?: ThemeFs;
}

export function readThemesList(deps: ThemeResourceDeps): Promise<ThemesList> {
  if (!deps.themesPath) return Promise.resolve({ themesPath: null, themes: [] });
  const fs: ThemeFs = deps.fs ?? new LocalThemeFs();
  return listThemes(deps.themesPath, fs).then((themes) => ({ themesPath: deps.themesPath ?? null, themes }));
}

export interface ThemeListEntry {
  slug: string;
  name: string;
  path: string;
  manifest: { name: string; version: string; author: string };
}

export interface ThemesList {
  themesPath: string | null;
  themes: ThemeListEntry[];
}

async function listThemes(themesPath: string, fs: ThemeFs): Promise<ThemeListEntry[]> {
  if (!(await fs.exists(themesPath))) return [];
  const names = new Set<string>();
  for (const file of await fs.list(themesPath, { extensions: [] })) {
    const parts = file.split("/").filter(Boolean);
    if (parts.length === 2 && parts[1] === "theme.json" && SLUG_RE.test(parts[0]!)) {
      names.add(parts[0]!);
    }
  }
  const slugs = [...names].sort();
  const out: ThemeListEntry[] = [];
  for (const slug of slugs) {
    const manifest = await readManifest(fs, themesPath, slug);
    out.push({ slug, name: manifest.name, path: path.join(themesPath, slug), manifest });
  }
  return out;
}

async function readManifest(fs: ThemeFs, themesPath: string, slug: string) {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(themesPath, slug, "theme.json")));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const m = raw as Record<string, unknown>;
      return {
        name: typeof m.name === "string" ? m.name : slug,
        version: typeof m.version === "string" ? m.version : "",
        author: typeof m.author === "string" ? m.author : "",
      };
    }
  } catch { /* ignore */ }
  return { name: slug, version: "", author: "" };
}

export async function readThemeSchema(
  deps: ThemeResourceDeps,
  slug: string,
): Promise<unknown> {
  if (!deps.themesPath) throw new AutomadMcpError("NOT_FOUND", "themesPath not configured");
  if (!SLUG_RE.test(slug) || slug.includes("..") || path.isAbsolute(slug)) {
    throw new AutomadMcpError("NOT_FOUND", `unknown theme '${slug}'`);
  }
  const fs: ThemeFs = deps.fs ?? new LocalThemeFs();
  const analyzer = new ThemeAnalyzer({ fs, themesPath: deps.themesPath });
  const builder = new ThemeSchemaBuilder();
  const analysis = await analyzer.analyze(slug);
  return builder.build(analysis);
}
```

- [ ] **Step 4: Run focused resource tests and build**

Run:

```bash
npm test -- tests/unit/resources.test.ts --reporter=dot
npm run build
```

Expected: all resource tests and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/themes.ts tests/unit/resources.test.ts
git commit -m "feat(resources): add theme resource dispatcher"
```

---

### Task 2: Register MCP resources in the server

**Files:**
- Modify `src/server.ts:50-152`
- Modify `tests/unit/server.test.ts:48-82`

**Interfaces:**
- Registers `automad://themes` and `automad://themes/{slug}/schema` as MCP resource templates.
- Switches server capabilities to include `resources: { listChanged: false }`.

- [ ] **Step 1: Write failing server resource tests**

Add assertions to `tests/unit/server.test.ts`:

```ts
const server = createAutomadServer({ client, guard: new WriteGuard(cfg()), config: cfg() });
const caps = server.server.getServerCapabilities();
expect(caps.resources).toEqual({ listChanged: false });
const mcp = new Client({ name: "test", version: "0" }, { capabilities: {} });
const [t1, t2] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(t1), mcp.connect(t2)]);
const resources = await mcp.listResources();
expect(resources.resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
  "automad://themes",
  "automad://themes/{slug}/schema",
]);
expect(resources.resources).toEqual([
  { uri: "automad://themes", name: "themes", mimeType: "application/json" },
]);
const toolNames = (await mcp.listTools()).tools.map((t) => t.name).sort();
expect(toolNames).toEqual([
  "automad_config", "automad_media", "automad_pages",
  "automad_shared", "automad_site", "automad_theme",
]);
```

- [ ] **Step 2: Run focused server tests and verify RED**

Run:

```bash
npm test -- tests/unit/server.test.ts --reporter=dot
```

Expected: failure because the new templates and capability are absent.

- [ ] **Step 3: Register resources and switch capabilities**

Update `src/server.ts`:

- change `new McpServer(..., { capabilities: { tools: { listChanged: false } } })` to:

```ts
{ capabilities: { resources: { listChanged: false }, tools: { listChanged: false } } }
```

- import `ResourceTemplate` from the MCP SDK and `readThemesList`/`readThemeSchema` from `./resources/themes.js`;
- after the existing `registerTool` calls, add:

```ts
server.registerResource(
  "themes",
  new ResourceTemplate("automad://themes", { list: undefined }),
  { title: "Themes", description: "List of discovered themes" },
  async () => ({
    contents: [
      {
        uri: "automad://themes",
        mimeType: "application/json",
        text: JSON.stringify(await readThemesList({ themesPath: config.themesPath })),
      },
    ],
  }),
);

server.registerResource(
  "theme-schema",
  new ResourceTemplate("automad://themes/{slug}/schema", { list: undefined }),
  { title: "Theme schema", description: "Normalized theme schema" },
  async (_uri, variables) => {
    const slug = typeof variables.slug === "string" ? variables.slug : "";
    const data = await readThemeSchema({ themesPath: config.themesPath }, slug);
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
```

If `ResourceTemplate` lacks the `list` option in the installed SDK version, omit it. Keep the constructor signature required by the installed version.

- [ ] **Step 4: Run focused server tests and build**

Run:

```bash
npm test -- tests/unit/server.test.ts --reporter=dot
npm run build
```

Expected: server tests and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/unit/server.test.ts
git commit -m "feat(resources): register theme MCP resources"
```

---

### Task 3: Document and fully verify Theme Resources

**Files:**
- Modify `README.md:56-90,180-220`
- No production changes unless verification exposes a defect.

**Interfaces:**
- Documents the two MCP resources, the URI scheme, and the read-only guarantee.

- [ ] **Step 1: Update README**

Add a `### MCP resources` section after the tool list:

- list of resources (`automad://themes`, `automad://themes/{slug}/schema`);
- JSON response examples;
- read-only guarantee;
- reuse of `automad_theme.schema` output;
- no new MCP tool or auth/audit/HTTP changes.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
npm run build
npm test -- tests/unit/resources.test.ts tests/unit/server.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

Expected: build succeeds, focused tests pass, full suite passes, lint exits zero.

- [ ] **Step 3: Verify MCP contract and repository state**

Run:

```bash
git diff --check
git status --short --branch
git diff --stat HEAD~3..HEAD
```

Expected: only intended source/test/docs changes, no generated files or credentials, six tools still present, `resources.listChanged === false`.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs(resources): document theme MCP resources"
```
