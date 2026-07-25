import { AutomadMcpError } from "../errors.js";

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

type ExpectedActions = Readonly<Record<string, readonly string[]>>;
/** Tool → every action name it advertises. Exported for drift tests against write-guard.ts. */
export const EXPECTED_ACTIONS: ExpectedActions = {
  automad_pages: ["list", "get", "create", "update", "delete", "move", "duplicate", "publish", "batch_update"],
  automad_media: ["list", "upload"],
  automad_shared: ["get", "set"],
  automad_config: ["get", "set"],
  automad_site: ["info", "search", "health"],
  automad_docs: ["list", "search", "get"],
  automad_theme: [
    "list", "install", "activate", "uninstall", "scaffold", "build", "read", "write", "files", "analyze", "validate", "schema", "diff", "generate",
  ],
};

/** Map tool name → WriteAction prefix (e.g. "automad_pages" → "pages"). */
export const WRITE_ACTION_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  automad_pages: "pages",
  automad_media: "media",
  automad_shared: "shared",
  automad_config: "config",
  automad_site: "site",
  automad_docs: "docs",
  automad_theme: "theme",
});

export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = [
  {
    name: "automad_pages",
    title: "Pages",
    description: "Manage Automad pages.",
    actions: {
      list: read("List pages."),
      get: read("Read one page."),
      create: write("Create a page."),
      update: write("Update a page."),
      delete: destructive("Delete a page."),
      move: destructive("Reorder a page."),
      duplicate: write("Duplicate a page (creates a copy; non-destructive)."),
      publish: write("Publish a page (draft to live)."),
      batch_update: write("Update multiple pages sequentially."),
    },
  },
  {
    name: "automad_media",
    title: "Media",
    description: "Manage Automad media.",
    actions: {
      list: read("List media files."),
      upload: write("Upload a media file."),
    },
  },
  {
    name: "automad_shared",
    title: "Shared data",
    description: "Manage site-wide shared data.",
    actions: {
      get: read("Read shared data."),
      set: write("Update shared data."),
    },
  },
  {
    name: "automad_config",
    title: "Config",
    description: "Manage Automad configuration.",
    actions: {
      get: read("Read configuration data."),
      set: write("Update configuration data."),
    },
  },
  {
    name: "automad_site",
    title: "Site",
    description: "Inspect and search the site.",
    actions: {
      info: read("Read site information."),
      search: read("Search site content."),
      health: read("Check live-instance connectivity and status."),
    },
  },
  {
    name: "automad_docs",
    title: "Docs",
    description: "Offline Automad v2 knowledge base.",
    actions: {
      list: read("List documentation pages."),
      search: read("Search the knowledge base."),
      get: read("Read a documentation page."),
    },
  },
  {
    name: "automad_theme",
    title: "Theme",
    description: "Manage and inspect local themes.",
    actions: {
      list: read("List themes."),
      install: destructive("Install a theme."),
      activate: destructive("Activate a theme."),
      uninstall: destructive("Uninstall a theme."),
      scaffold: destructive("Create a theme from the starter kit."),
      build: destructive("Build a theme."),
      read: read("Read a theme file."),
      write: destructive("Write a theme file."),
      files: read("List theme files."),
      analyze: read("Analyze a theme offline."),
      validate: read("Validate a theme offline."),
      schema: read("Build a normalized theme schema."),
      diff: read("Preview a file change without writing."),
      generate: read("Generate a snippet, block, or component."),
    },
  },
] as const;

export function validateCapabilityRegistry(
  registry: readonly CapabilityDefinition[] = CAPABILITY_REGISTRY,
): void {
  const names = new Set<string>();
  for (const capability of registry) {
    if (!capability.name) throw new Error("Capability name must not be empty");
    if (names.has(capability.name)) throw new Error(`Duplicate capability name: ${capability.name}`);
    names.add(capability.name);
    if (!capability.title) throw new Error(`Capability title must not be empty: ${capability.name}`);
    if (!capability.description) throw new Error(`Capability description must not be empty: ${capability.name}`);

    for (const [actionName, action] of Object.entries(capability.actions)) {
      if (!actionName) throw new Error(`Capability action name must not be empty: ${capability.name}`);
      if (!action.description) throw new Error(`Capability action description must not be empty: ${capability.name}.${actionName}`);
      if (action.readOnly && action.destructive) {
        throw new Error(`Capability action ${capability.name}.${actionName} cannot be both readOnly and destructive`);
      }
    }
  }

  for (const expectedName of Object.keys(EXPECTED_ACTIONS)) {
    if (!names.has(expectedName)) throw new Error(`Missing capability: ${expectedName}`);
  }
  for (const capability of registry) {
    if (!(capability.name in EXPECTED_ACTIONS)) throw new Error(`Unexpected capability: ${capability.name}`);
    const expected = EXPECTED_ACTIONS[capability.name] ?? [];
    const actual = Object.keys(capability.actions);
    for (const action of expected) {
      if (!actual.includes(action)) throw new Error(`Missing action ${capability.name}.${action}`);
    }
    for (const action of actual) {
      if (!expected.includes(action)) throw new Error(`Unexpected action ${capability.name}.${action}`);
    }
  }
}

export function getCapability(name: string): CapabilityDefinition {
  const capability = CAPABILITY_REGISTRY.find((entry) => entry.name === name);
  if (!capability) throw new AutomadMcpError("NOT_FOUND", `Unknown capability: ${name}`);
  return capability;
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

validateCapabilityRegistry();
