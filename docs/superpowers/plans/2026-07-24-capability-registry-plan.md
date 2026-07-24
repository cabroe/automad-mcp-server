# Capability Registry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static internal capability registry that describes and validates all existing Automad MCP router actions without changing the public MCP contract.

**Architecture:** Create `src/capabilities/registry.ts` as a pure declarative metadata module. It exports six router definitions, action-level read-only/destructive metadata, lookup, and invariant validation. `createAutomadServer` validates the production registry at construction time while retaining the six explicit `registerTool` calls and all existing handler/guard behavior.

**Tech Stack:** TypeScript 5.x, Node.js 20+, MCP SDK, Zod schemas, Vitest, ESLint, existing `WriteGuard`.

## Global Constraints

- Phase 1 adds only an internal capability registry; public tools remain exactly six.
- Existing tool names, titles, action parameters, Zod schemas, handler results, errors, stdio behavior, and WriteGuard decisions remain unchanged.
- The registry is static and declarative; handlers do not self-register and router tools are not replaced by one tool per action.
- Registry loading and validation perform no I/O, network access, token handling, audit logging, or environment inspection.
- `validateCapabilityRegistry` throws precise `Error` messages for invalid registry definitions.
- Every router and action has a non-empty description.
- No action may have both `readOnly: true` and `destructive: true`.
- The expected router/action map is a static internal constant, not inferred from runtime Zod internals.
- Tests require no Docker, Automad instance, credentials, network access, or environment variables.

---

## File Map

- Create `src/capabilities/registry.ts`: capability types, expected action map, production registry, validation, lookup.
- Create `tests/unit/capabilities.test.ts`: registry contents, flags, validation failures, lookup behavior.
- Modify `src/server.ts:1-59`: import and validate the production registry during server construction.
- Modify `tests/unit/server.test.ts:48-66`: preserve six-tool registration and prove server construction still succeeds with registry validation.

## Shared Interfaces

```ts
export interface CapabilityAction {
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly description: string;
}

export interface CapabilityDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly actions: Readonly<Record<string, CapabilityAction>>;
}

export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[];

export function validateCapabilityRegistry(
  registry?: readonly CapabilityDefinition[],
): void;

export function getCapability(name: string): CapabilityDefinition;
```

---

### Task 1: Implement registry types and production definitions

**Files:**
- Create `src/capabilities/registry.ts`
- Create `tests/unit/capabilities.test.ts`

**Interfaces:**
- Produces `CapabilityAction`, `CapabilityDefinition`, `CAPABILITY_REGISTRY`, `validateCapabilityRegistry`, and `getCapability`.
- No dependency on MCP SDK, Zod, filesystem, network, environment, or server state.

- [ ] **Step 1: Write failing registry tests**

Create tests asserting the production registry has exactly these router names:

```ts
const expected = [
  "automad_pages",
  "automad_media",
  "automad_shared",
  "automad_config",
  "automad_site",
  "automad_theme",
];
expect(CAPABILITY_REGISTRY.map((entry) => entry.name)).toEqual(expected);
```

Assert exact action sets:

```ts
expect(Object.keys(getCapability("automad_pages").actions).sort()).toEqual(
  ["create", "delete", "duplicate", "get", "list", "move", "update"],
);
expect(Object.keys(getCapability("automad_media").actions).sort()).toEqual(["list", "upload"]);
expect(Object.keys(getCapability("automad_shared").actions).sort()).toEqual(["get", "set"]);
expect(Object.keys(getCapability("automad_config").actions).sort()).toEqual(["get", "set"]);
expect(Object.keys(getCapability("automad_site").actions).sort()).toEqual(["info", "search"]);
expect(Object.keys(getCapability("automad_theme").actions).sort()).toEqual([
  "activate", "analyze", "build", "files", "install", "list", "read", "scaffold", "uninstall", "validate", "write",
]);
```

Assert every router and action has non-empty descriptions, no action has both flags true, and `validateCapabilityRegistry()` accepts the production registry. Add lookup tests for a known and an unknown router.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/unit/capabilities.test.ts --reporter=dot
```

Expected: module-not-found or missing-export failures because the registry module does not exist.

- [ ] **Step 3: Implement the registry**

Create a static `EXPECTED_ACTIONS` object and a `CAPABILITY_REGISTRY` array with the exact router/action sets above.

Use these classifications:

```text
readOnly=true, destructive=false:
pages.list, pages.get, media.list, shared.get, config.get,
site.info, site.search, theme.list, theme.read, theme.files,
theme.analyze, theme.validate

readOnly=false, destructive=true:
pages.delete, pages.move, pages.duplicate, theme.install,
theme.activate, theme.uninstall, theme.scaffold, theme.build, theme.write

readOnly=false, destructive=false:
pages.create, pages.update, media.upload, shared.set, config.set
```

Give each action a concise non-empty description. Keep the production array `as const` or `readonly` so consumers cannot mutate it accidentally.

Implement `validateCapabilityRegistry(registry = CAPABILITY_REGISTRY)` with these checks in order:

1. reject duplicate or empty router names;
2. reject empty router title/description;
3. reject empty action names/descriptions;
4. reject flags where both `readOnly` and `destructive` are true;
5. reject missing required router names;
6. reject missing or extra actions against `EXPECTED_ACTIONS`.

Use precise errors such as:

```text
Duplicate capability name: automad_pages
Missing capability: automad_theme
Unexpected action automad_pages.archive
Missing action automad_theme.validate
Capability action automad_pages.list cannot be both readOnly and destructive
```

`getCapability(name)` should search the production registry and throw `Error("Unknown capability: <name>")` when absent.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/capabilities.test.ts --reporter=dot
```

Expected: all registry tests pass.

- [ ] **Step 5: Add mutation/invariant failure tests**

Extend the test file with cloned custom registries proving validation rejects:

```ts
validateCapabilityRegistry([
  ...CAPABILITY_REGISTRY,
  CAPABILITY_REGISTRY[0],
]); // duplicate capability

validateCapabilityRegistry(
  CAPABILITY_REGISTRY.filter((entry) => entry.name !== "automad_theme"),
); // missing capability

validateCapabilityRegistry(
  CAPABILITY_REGISTRY.map((entry) =>
    entry.name === "automad_pages"
      ? { ...entry, actions: { ...entry.actions, archive: { readOnly: true, destructive: false, description: "Archive" } } }
      : entry,
  ),
); // unexpected action

validateCapabilityRegistry(
  CAPABILITY_REGISTRY.map((entry) =>
    entry.name === "automad_pages"
      ? { ...entry, actions: { ...entry.actions, list: { readOnly: true, destructive: true, description: "List" } } }
      : entry,
  ),
); // contradictory flags
```

Assert each throws a message naming the violated invariant.

- [ ] **Step 6: Run focused registry tests**

Run the same focused command. Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/capabilities/registry.ts tests/unit/capabilities.test.ts
git commit -m "feat(capabilities): add static router registry"
```

---

### Task 2: Validate registry during server construction

**Files:**
- Modify `src/server.ts:1-59`
- Modify `tests/unit/server.test.ts:48-66`

**Interfaces:**
- Consumes `CAPABILITY_REGISTRY` and `validateCapabilityRegistry` from Task 1.
- Produces no new public MCP tools or actions.

- [ ] **Step 1: Write failing server integration test**

Add a test proving `createAutomadServer` invokes registry validation while preserving the existing six-tool list. Use a module spy or a deliberately exported validation call seam that can be observed without changing the public server API. The assertion must still call `mcp.listTools()` and expect exactly:

```ts
[
  "automad_config",
  "automad_media",
  "automad_pages",
  "automad_shared",
  "automad_site",
  "automad_theme",
]
```

- [ ] **Step 2: Run focused server tests and verify RED**

Run:

```bash
npm test -- tests/unit/server.test.ts --reporter=dot
```

Expected: the new registry-validation assertion fails because `server.ts` does not import or call the registry validator.

- [ ] **Step 3: Integrate validation conservatively**

Add:

```ts
import { validateCapabilityRegistry } from "./capabilities/registry.js";
```

At the start of `createAutomadServer`, before constructing the MCP server, call:

```ts
validateCapabilityRegistry();
```

Do not replace explicit `registerTool` calls with a loop. Do not change tool titles, descriptions, input schemas, handlers, error wrapping, or capabilities.

- [ ] **Step 4: Run focused server tests**

Run:

```bash
npm test -- tests/unit/server.test.ts tests/unit/capabilities.test.ts --reporter=dot
```

Expected: all focused tests pass and the six-tool list remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/unit/server.test.ts
git commit -m "feat(capabilities): validate registry during server startup"
```

---

### Task 3: Full verification and documentation

**Files:**
- Modify `README.md:56-81,185-220`
- No production file changes unless verification exposes a defect.

**Interfaces:**
- Documents the internal registry as an implementation foundation, not a new public MCP tool surface.

- [ ] **Step 1: Document Phase 1**

Add a concise architecture note explaining:

- the six public router tools remain unchanged;
- the internal registry describes action metadata and validates drift;
- the registry is not exposed as one tool per action;
- the registry performs no I/O or network work;
- future scopes, Resources, audit logging, and HTTP authorization can consume it.

Do not claim that Resources, HTTP, scoped tokens, or audit logging are implemented in this phase.

- [ ] **Step 2: Run type-check and all tests**

Run:

```bash
npm run build
npm test -- --reporter=dot
npm run lint
```

Expected: TypeScript succeeds, all tests pass, ESLint exits zero.

- [ ] **Step 3: Verify public MCP contract**

Run the existing server test and confirm `listTools()` still returns exactly six tool names. Confirm no new tool appears for individual actions.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --check
git status --short --branch
git diff --stat HEAD~2..HEAD
```

Expected: no whitespace errors, only registry/server/test/documentation changes, and no generated files or credentials.

- [ ] **Step 5: Commit documentation and final verification state**

```bash
git add README.md
git commit -m "docs: document capability registry foundation"
```
