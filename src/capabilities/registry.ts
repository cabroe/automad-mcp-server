import { AutomadMcpError } from '../errors.js';

/**
 * Single source of truth for the whole tool surface.
 *
 * Everything downstream is *derived* from `CAPABILITY_SPECS` below — there is
 * no second list to keep in sync:
 *
 *   - `WriteAction` (the guard's action union)      → type-level derivation
 *   - `READ_ACTIONS` / `DESTRUCTIVE_ACTIONS`        → `actionsWhere()`
 *   - each tool's Zod `action` enum                 → `advertisedActions()` (schemas.ts)
 *   - MCP tool registration (title/description/gate) → capabilities/tools.ts
 *   - `automad_discover` list/describe output       → domains/discover.ts
 *   - the README tool table + count markers         → scripts/sync.ts
 *
 * Adding a tool = one entry here + one binding in `capabilities/tools.ts`.
 * Adding an action = one entry here; the compiler then points at every
 * `Record<Action, WriteAction>` map that still needs a case.
 */

export interface CapabilityAction {
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly description: string;
  /**
   * Guard-only action: raised by a domain handler for fine-grained
   * confirmation (e.g. a title change inside `pages.update`), never callable
   * on its own. Internal actions stay out of every advertised surface — the
   * tool's `action` enum, `automad_discover`, and the docs table.
   */
  readonly internal?: true;
}

/** Guard-only variant — the literal `internal: true` is what `AdvertisedAction` filters on. */
export type InternalCapabilityAction = CapabilityAction & { readonly internal: true };

/** Runtime prerequisite of a tool — checked once per call before dispatch. */
export type ToolRequirement = 'none' | 'live' | 'themes';

export interface CapabilitySpec {
  readonly title: string;
  /** One-liner for the docs table and `discover.list`. */
  readonly summary: string;
  /** Full prose shown to the model as the MCP tool description. */
  readonly description: string;
  readonly requires: ToolRequirement;
  readonly actions: Readonly<Record<string, CapabilityAction>>;
}

export interface CapabilityDefinition extends CapabilitySpec {
  readonly name: string;
}

const CAPABILITY_SPECS = {
  automad_pages: {
    title: 'Pages',
    summary: 'Manage Automad pages.',
    description:
      'Manage Automad v2 pages: list, get, create, update, delete, move, duplicate. Uses /_api/page/* and /_api/public/pagelist.',
    requires: 'live',
    actions: {
      list: read('List pages.'),
      get: read('Read one page.'),
      create: write('Create a page.'),
      update: write('Update a page.'),
      delete: destructive('Delete a page.'),
      move: destructive('Reorder a page.'),
      duplicate: write('Duplicate a page (creates a copy; non-destructive).'),
      publish: write('Publish a page (draft to live).'),
      batch_update: write('Update multiple pages sequentially.'),
      trash_list: read('List pages currently in trash.'),
      trash_restore: destructive(
        'Restore a trashed page. Pass its `path` from `trash_list` (e.g. "/.trash/my-page") as `url` — not the URL the page had before it was deleted.',
      ),
      trash_permanently_delete: destructive(
        'Permanently delete one trashed page. Pass its `path` from `trash_list` as `url`, not its former URL.',
      ),
      trash_clear: destructive('Empty the trash (deletes all trashed pages permanently).'),
      history: read('List the change history for a page (v2 history log).'),
      history_restore: destructive('Restore a page to a prior history entry (by logId).'),
      breadcrumbs: read('Get the breadcrumb trail for a page.'),
      publication_state: read('Get the publication state (draft / published) for a page.'),
      recent: read('List recently edited pages (v2 page-collection/get-recently-edited, alias of list).'),
      discard_draft: destructive('Discard a page draft and revert to the last published version.'),
      update_rename: internal(
        'Rename a page — raised by update/batch_update when the title changes.',
      ),
    },
  },
  automad_media: {
    title: 'Media',
    summary: 'Manage Automad media.',
    description:
      'Manage Automad v2 media: list files for a page/shared directory, upload (single-chunk), or import from a URL. Uses /_api/file-collection/* and /_api/file/import.',
    requires: 'live',
    actions: {
      list: read('List media files.'),
      upload: write('Upload a media file.'),
      import: write(
        'Import a file from an http(s) URL into a page (or the shared directory when url is omitted). Automad downloads it server-side, so the URL must be reachable from the Automad host, not from here, and the extension must be one the site allows (a URL without a file extension is rejected). Automad renames the stored file — call `list` afterwards to learn the actual name — and silently overwrites an existing file of the same name.',
      ),
      delete: destructive('Delete a media file.'),
    },
  },
  automad_shared: {
    title: 'Shared data',
    summary: 'Manage site-wide shared data.',
    description:
      'Site-wide shared data (sitename, consent, custom fields): get and set. Uses /_api/shared/data.',
    requires: 'live',
    actions: {
      get: read('Read shared data.'),
      set: write('Update shared data.'),
    },
  },
  automad_config: {
    title: 'Config',
    summary: 'Manage Automad configuration.',
    description:
      'Site config: `get` returns envKeys/sitename/version from /_api/app/bootstrap; `set` posts to /_api/config/update with a type discriminator (cache, feed, debug, etc.).',
    requires: 'live',
    actions: {
      get: read('Read configuration data.'),
      set: write('Update configuration data.'),
      cache_clear: destructive('Clear the v2 cache (PageCache + ResponseCache).'),
      cache_purge: destructive('Purge the v2 cache (more aggressive than clear).'),
    },
  },
  automad_site: {
    title: 'Site',
    summary: 'Inspect and search the site.',
    description:
      'Site-level: `info` returns bootstrap data; `search` queries /_api/search/search-replace (read-only when `replace` is omitted).',
    requires: 'live',
    actions: {
      info: read('Read site information.'),
      search: read('Search site content.'),
      health: read('Check live-instance connectivity and status.'),
      search_replace: internal(
        'Replace across the whole site — raised by search when `replace` is set.',
      ),
    },
  },
  automad_docs: {
    title: 'Docs',
    summary: 'Offline Automad v2 knowledge base.',
    description:
      'Offline Automad v2 knowledge base: `list` pages, `search` by query, `get` a page by slug. ' +
      'Works without a live instance (also in AUTOMAD_MODE=docs). Covers template syntax, control structures, ' +
      'navigation, i18n, blocks, theme.json, headless/REST API, and getting started.',
    requires: 'none',
    actions: {
      list: read('List documentation pages.'),
      search: read('Search the knowledge base.'),
      get: read('Read a documentation page.'),
    },
  },
  automad_theme: {
    title: 'Theme',
    summary: 'Manage and inspect local themes.',
    description:
      'Local-filesystem theme tooling (zero config: themes default to `<cwd>/automad-themes`, override with AUTOMAD_THEMES_PATH). ' +
      'list/install/activate/uninstall/scaffold/build/dev/dev_stop/dev_status, plus read/write/files for theme files (theme.json, .php, blocks/, .ts). ' +
      'Scaffold copies the bundled starter kit into a new theme dir; build runs `npm install` + `npm run build`; dev runs `npm install` (if needed) + `npm run dev` as a detached process.',
    requires: 'themes',
    actions: {
      list: read('List themes.'),
      install: destructive('Install a theme.'),
      activate: destructive('Activate a theme.'),
      uninstall: destructive('Uninstall via v2 PackageManager.remove, then remove the on-disk dir (fs fallback if v2 returns NOT_FOUND).'),
      list_installed: read('List installed packages via v2 PackageManager (get-package-collection).'),
      outdated: read('List packages that have updates available (v2 get-outdated).'),
      update: destructive('Update a single installed package (v2 update).'),
      update_all: destructive('Update all installed packages (v2 update-all).'),
      scaffold: destructive('Create a theme from the starter kit.'),
      build: destructive('Build a theme.'),
      dev: destructive('Install dependencies and start the theme dev server in the background.'),
      dev_stop: destructive('Stop the theme dev server started by `dev`.'),
      dev_status: read('Read the status of the theme dev server.'),
      read: read('Read a theme file.'),
      write: destructive('Write a theme file.'),
      files: read('List theme files.'),
      analyze: read('Analyze a theme offline.'),
      validate: read('Validate a theme offline.'),
      schema: read('Build a normalized theme schema.'),
      diff: read('Preview a file change without writing.'),
      generate: read('Generate a snippet, block, or component.'),
    },
  },
  automad_image: {
    title: 'Image',
    summary: 'Manage image variants via v2 image controllers.',
    description:
      'Image variants: `list` returns rendered variants; `save` uploads a base64-encoded image (resize/crop). Uses /_api/image-collection/list and /_api/image/save.',
    requires: 'live',
    actions: {
      list: read('List rendered image variants.'),
      save: destructive('Save a base64-encoded image (resize/crop via v2).'),
    },
  },
  automad_components: {
    title: 'Components',
    summary: 'Manage per-page component fields (v2 ComponentController).',
    description:
      'Site-wide component fields: `data` reads the component store; `publication_state` returns the draft/published state; `discard_draft` reverts a component draft; `publish` publishes component changes. Uses /_api/component/*. Writing the component store is not exposed — the same v2 endpoint doubles as a writer, and conflating the two once cost the store its contents.',
    requires: 'live',
    actions: {
      data: read('Read the site-wide component store.'),
      publication_state: read('Get the publication state of component fields for a page.'),
      discard_draft: destructive('Discard component draft and revert to published state.'),
      publish: destructive('Publish component changes for a page.'),
    },
  },
  automad_mail: {
    title: 'Mail',
    summary: 'Manage Automad mail configuration (v2 MailConfigController).',
    description:
      'SMTP config and test mail: `save` writes transport/from/server/credentials; `test` sends a test email to `to`; `reset` clears the config. Uses /_api/mail-config/*.',
    requires: 'live',
    actions: {
      save: destructive('Save mail configuration (transport, from, SMTP server/credentials).'),
      test: destructive('Send a test email to a recipient address.'),
      reset: destructive('Reset mail configuration to defaults.'),
    },
  },
  automad_system: {
    title: 'System',
    summary: 'Check for and run Automad core updates (v2 SystemController).',
    description:
      'Core v2 update: `check_for_update` queries the update server; `update` runs the update. Uses /_api/system/*.',
    requires: 'live',
    actions: {
      check_for_update: read('Check the Automad update server for a new version.'),
      update: destructive('Run the Automad core update.'),
    },
  },
  automad_file_meta: {
    title: 'File meta',
    summary: 'Edit file metadata (alt text, etc.) via v2 FileController.',
    description:
      'Rename a file and set its caption without re-uploading. Pass `url` for the page whose directory holds the file (omit it for the shared directory) — v2 resolves the file relative to that. Renaming also rewrites links to the file across the site. Uses /_api/file/edit-info.',
    requires: 'live',
    actions: {
      edit_info: destructive('Rename a file and/or set its caption. Also updates links to it site-wide.'),
    },
  },
  automad_discover: {
    title: 'Discover',
    summary: 'Introspect available tools and actions.',
    description:
      'Introspect available tools and actions: `list` every tool+action with read-only/destructive flags, ' +
      "`describe` a tool's full input schema (optionally narrowed to one action). Works without a live instance " +
      "(also in AUTOMAD_MODE=docs) — useful when the full action surface doesn't need to sit in context up front.",
    requires: 'none',
    actions: {
      list: read('List every tool+action with read-only/destructive flags and a one-line summary.'),
      describe: read(
        'Return the input schema and action metadata for one tool, optionally narrowed to one action.',
      ),
    },
  },
} as const satisfies Readonly<Record<string, CapabilitySpec>>;

type CapabilitySpecs = typeof CAPABILITY_SPECS;

/** Registered MCP tool names, e.g. `"automad_pages"`. */
export type ToolName = keyof CapabilitySpecs & string;

/** Every action a tool declares — including internal, guard-only ones. */
export type ActionName<T extends ToolName> = keyof CapabilitySpecs[T]['actions'] & string;

type CallableKeys<A> = { [K in keyof A]-?: A[K] extends { internal: true } ? never : K }[keyof A];

/** The actions a tool actually exposes — `ActionName` minus the internal ones. */
export type AdvertisedAction<T extends ToolName> = CallableKeys<CapabilitySpecs[T]['actions']> &
  string;

/** `"automad_pages"` → `"pages"`. Enforced by `validateCapabilityRegistry`. */
export const TOOL_NAME_PREFIX = 'automad_';
type ToolPrefix<T extends string> = T extends `${typeof TOOL_NAME_PREFIX}${infer P}` ? P : never;

/**
 * Guard action union — `"pages.delete" | "media.upload" | …` — derived from
 * the registry, so a new registry action is immediately a valid `WriteAction`
 * (and a removed one immediately stops compiling).
 */
export type WriteAction = { [T in ToolName]: `${ToolPrefix<T>}.${ActionName<T>}` }[ToolName];

/** Tool names in registration order. `Object.keys` erases the literal keys the record was built from. */
export const TOOL_NAMES = Object.keys(CAPABILITY_SPECS) as readonly ToolName[];

export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = Object.entries(
  CAPABILITY_SPECS,
).map(([name, spec]) => ({ name, ...spec }));

/** `"automad_pages"` → `"pages"`. */
export function toolPrefix(name: string): string {
  return name.startsWith(TOOL_NAME_PREFIX) ? name.slice(TOOL_NAME_PREFIX.length) : name;
}

/** `("automad_pages", "delete")` → `"pages.delete"`. */
export function writeActionOf(name: string, action: string): WriteAction {
  // Both halves come from the registry the union is derived from.
  return `${toolPrefix(name)}.${action}` as WriteAction;
}

/**
 * Callable actions of a tool — everything except internal, guard-only ones.
 * Backs each tool's Zod `action` enum and the discovery facade.
 */
export function advertisedActions<T extends ToolName>(tool: T): readonly AdvertisedAction<T>[] {
  // Keys of the registry entry are `AdvertisedAction<T>` once internals are filtered.
  return callableActions(getCapability(tool)).map(([action]) => action) as AdvertisedAction<T>[];
}

/**
 * A capability's public `[action, metadata]` pairs — internal, guard-only
 * actions filtered out. The one place that filter lives; the discovery facade
 * and the docs generator both go through it.
 */
export function callableActions(
  capability: CapabilityDefinition,
): readonly [string, CapabilityAction][] {
  return Object.entries(capability.actions).filter(([, meta]) => !meta.internal);
}

/** Every `WriteAction` whose metadata matches `predicate` (internal actions included). */
export function actionsWhere(
  predicate: (action: CapabilityAction) => boolean,
): ReadonlySet<WriteAction> {
  const matches = new Set<WriteAction>();
  for (const capability of CAPABILITY_REGISTRY) {
    for (const [action, meta] of Object.entries(capability.actions)) {
      if (predicate(meta)) matches.add(writeActionOf(capability.name, action));
    }
  }
  return matches;
}

export function getCapability(name: string): CapabilityDefinition {
  const capability = CAPABILITY_REGISTRY.find((entry) => entry.name === name);
  if (!capability) throw new AutomadMcpError('NOT_FOUND', `Unknown capability: ${name}`);
  return capability;
}

const VALID_REQUIREMENTS: Record<ToolRequirement, true> = { none: true, live: true, themes: true };

/**
 * Structural invariants of the registry, checked at import time (and again at
 * server boot). These are the rules the derivations above rely on — unique
 * names and prefixes, a non-empty callable action set per tool, and flags that
 * don't contradict each other.
 */
export function validateCapabilityRegistry(
  registry: readonly CapabilityDefinition[] = CAPABILITY_REGISTRY,
): void {
  const names = new Set<string>();
  const prefixes = new Set<string>();
  for (const capability of registry) {
    if (!capability.name) throw new Error('Capability name must not be empty');
    if (names.has(capability.name))
      throw new Error(`Duplicate capability name: ${capability.name}`);
    names.add(capability.name);
    if (!capability.name.startsWith(TOOL_NAME_PREFIX)) {
      throw new Error(`Capability name must start with "${TOOL_NAME_PREFIX}": ${capability.name}`);
    }
    const prefix = toolPrefix(capability.name);
    if (prefixes.has(prefix)) throw new Error(`Duplicate capability prefix: ${prefix}`);
    prefixes.add(prefix);
    if (!capability.title)
      throw new Error(`Capability title must not be empty: ${capability.name}`);
    if (!capability.summary)
      throw new Error(`Capability summary must not be empty: ${capability.name}`);
    if (!capability.description)
      throw new Error(`Capability description must not be empty: ${capability.name}`);
    if (!VALID_REQUIREMENTS[capability.requires]) {
      throw new Error(`Capability requires must be none|live|themes: ${capability.name}`);
    }

    let callable = 0;
    for (const [actionName, action] of Object.entries(capability.actions)) {
      if (!actionName)
        throw new Error(`Capability action name must not be empty: ${capability.name}`);
      if (!action.description)
        throw new Error(
          `Capability action description must not be empty: ${capability.name}.${actionName}`,
        );
      if (action.readOnly && action.destructive) {
        throw new Error(
          `Capability action ${capability.name}.${actionName} cannot be both readOnly and destructive`,
        );
      }
      if (action.internal) {
        if (action.readOnly) {
          throw new Error(`Internal action ${capability.name}.${actionName} must not be read-only`);
        }
      } else {
        callable++;
      }
    }
    if (callable === 0)
      throw new Error(`Capability declares no callable actions: ${capability.name}`);
  }
}

function read(description: string): CapabilityAction {
  return { readOnly: true, destructive: false, description };
}

function write(description: string): CapabilityAction {
  return { readOnly: false, destructive: false, description };
}

function destructive(description: string): CapabilityAction {
  return { readOnly: false, destructive: true, description };
}

/** Guard-only, always destructive: exists so a sub-case of a write can be confirmed separately. */
function internal(description: string): InternalCapabilityAction {
  return { readOnly: false, destructive: true, internal: true, description };
}

validateCapabilityRegistry();
