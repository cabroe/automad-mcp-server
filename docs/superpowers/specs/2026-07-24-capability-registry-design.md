# Capability Registry Foundation

**Date:** 2026-07-24
**Status:** Draft for user review

## Goal

Introduce a static, declarative internal capability registry for the Automad MCP server while preserving the existing six public domain-router tools, MCP input contracts, handler behavior, and stdio transport.

## Phase 1 Scope

In scope:

- Add an internal capability registry describing the six existing public routers.
- Describe every existing router action with a read-only/destructive classification and concise description.
- Add deterministic registry validation for duplicate actions, contradictory flags, missing routers, and action/schema coverage.
- Use the registry from server setup for metadata and consistency checks without changing the public MCP tool list or creating one tool per action.
- Add focused unit tests and preserve all existing tests.

Out of scope:

- MCP Resources or Prompts.
- Scoped tokens, OAuth, HTTP transport, rate limiting, or persistent audit logging.
- Changing `WriteGuard` runtime behavior.
- Replacing domain routers with individual public tools.
- Automatic generation of user-facing MCP schemas from the registry.
- New Automad API endpoints or new CMS domains.

## Current Architecture

The server currently exposes six tools through `src/server.ts`:

```text
automad_pages
automad_media
automad_shared
automad_config
automad_site
automad_theme
```

Each tool receives an `action` property validated by a Zod schema and dispatches to an existing domain handler. Write permissions are enforced by `WriteGuard`, while theme actions also operate on the local filesystem.

## Architecture Decision

Use a static declarative registry in `src/capabilities/registry.ts`. Do not let handlers self-register and do not replace router tools with one MCP tool per action.

The registry is metadata and an invariant boundary, not a second execution dispatcher:

```text
MCP request
  -> existing public router tool
  -> existing Zod schema
  -> existing domain handler
  -> existing WriteGuard / API / ThemeFs

Registry
  -> describes router/action coverage
  -> validates consistency during server creation
  -> supplies metadata for future scopes, Resources, and audit logs
```

## Public Contract Invariants

Phase 1 MUST preserve:

- exactly six entries from `listTools()`;
- existing tool names and titles;
- existing action parameters and Zod schemas;
- existing handler results and errors;
- stdio transport behavior;
- existing `WriteGuard` decisions;
- no new network, filesystem, token, or audit side effects from registry loading.

## Registry Types

Define named types:

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
```

Export:

```ts
export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[];
export function validateCapabilityRegistry(
  registry?: readonly CapabilityDefinition[],
): void;
export function getCapability(name: string): CapabilityDefinition;
```

`validateCapabilityRegistry` throws an `Error` with a precise message when invariants fail. It must not perform I/O or inspect environment variables.

## Registry Contents

The registry must contain these six router names exactly:

```text
automad_pages
automad_media
automad_shared
automad_config
automad_site
automad_theme
```

Action coverage must match current public schemas:

```text
automad_pages: list, get, create, update, delete, move, duplicate
automad_media: list, upload
automad_shared: get, set
automad_config: get, set
automad_site: info, search
automad_theme: list, install, activate, uninstall, scaffold, build, read, write, files, analyze, validate
```

Classify actions consistently with the current WriteGuard policy:

- `readOnly: true, destructive: false`: pages.list, pages.get, media.list, shared.get, config.get, site.info, site.search, theme.list, theme.read, theme.files, theme.analyze, theme.validate.
- `readOnly: false, destructive: true`: pages.delete, pages.move, theme.install, theme.activate, theme.uninstall, theme.scaffold, theme.build, theme.write.
- `readOnly: false, destructive: false`: pages.create, pages.update, media.upload, shared.set, config.set.
- `pages.duplicate` remains represented as `readOnly: false, destructive: true` because it is a mutation-shaped unsupported action and follows the existing destructive confirmation policy when reached.

No action may set both flags to `true`. Every action must have a non-empty description.

## Validation Rules

`validateCapabilityRegistry` MUST reject:

1. duplicate router names;
2. empty router names, titles, or descriptions;
3. duplicate action names within a router (including object construction through a test fixture);
4. actions with both `readOnly` and `destructive` true;
5. actions with an empty description;
6. missing required router names;
7. missing or extra actions compared with the explicit expected action map.

The expected router/action map is a static internal constant in the registry module. It is not inferred from runtime Zod internals, so validation remains deterministic and works without starting an MCP server.

## Server Integration

`src/server.ts` should import the registry and invoke `validateCapabilityRegistry()` during `createAutomadServer` construction. This catches accidental drift before serving requests.

The existing six `registerTool` calls remain explicit. Their current descriptions and input schemas stay unchanged in Phase 1. Do not replace the calls with a generic loop unless all public metadata and type behavior remain byte-for-byte equivalent and the change is justified by tests; the conservative implementation is validation-only integration.

## Testing

Create `tests/unit/capabilities.test.ts` covering:

- registry has exactly six expected routers;
- each router has the exact expected action set;
- all descriptions are non-empty;
- no action has contradictory flags;
- `validateCapabilityRegistry()` accepts the production registry;
- duplicate routers, missing routers, extra actions, contradictory flags, and empty descriptions throw precise errors;
- `getCapability()` returns a known definition and throws for an unknown name.

Update `tests/unit/server.test.ts` only as needed to prove server construction validates the registry and still exposes exactly six tools.

Run:

```bash
npm run build
npm test -- tests/unit/capabilities.test.ts tests/unit/server.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

No test may require Docker, an Automad instance, network access, or environment credentials.

## Future Extension Points

Later phases may consume this registry for:

- action-level token scopes;
- audit event metadata;
- MCP Resources and Prompts;
- capability discovery;
- Streamable HTTP authorization.

Those integrations are explicitly not part of Phase 1.
