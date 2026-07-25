import { describe, expect, it } from "vitest";
import {
  CAPABILITY_REGISTRY,
  advertisedActions,
  callableActions,
  getCapability,
  toolPrefix,
  validateCapabilityRegistry,
  writeActionOf,
  TOOL_NAMES,
  type CapabilityDefinition,
} from "../../src/capabilities/registry.js";

const expectedNames = [
  "automad_pages",
  "automad_media",
  "automad_shared",
  "automad_config",
  "automad_site",
  "automad_docs",
  "automad_theme",
  "automad_discover",
];

/** Replace one capability in a copy of the registry (validation is pure, the registry isn't). */
function patched(name: string, change: Partial<CapabilityDefinition>): CapabilityDefinition[] {
  return CAPABILITY_REGISTRY.map((entry) => (entry.name === name ? { ...entry, ...change } : entry));
}

describe("capability registry", () => {
  it("contains exactly the public routers and their callable actions", () => {
    expect(CAPABILITY_REGISTRY.map((entry) => entry.name)).toEqual(expectedNames);
    expect([...TOOL_NAMES]).toEqual(expectedNames);
    expect([...advertisedActions("automad_pages")].sort()).toEqual([
      "batch_update", "create", "delete", "duplicate", "get", "list", "move", "publish", "update",
    ]);
    expect([...advertisedActions("automad_media")].sort()).toEqual(["delete", "list", "upload"]);
    expect([...advertisedActions("automad_shared")].sort()).toEqual(["get", "set"]);
    expect([...advertisedActions("automad_config")].sort()).toEqual(["get", "set"]);
    expect([...advertisedActions("automad_site")].sort()).toEqual(["health", "info", "search"]);
    expect([...advertisedActions("automad_docs")].sort()).toEqual(["get", "list", "search"]);
    expect([...advertisedActions("automad_theme")].sort()).toEqual([
      "activate", "analyze", "build", "diff", "files", "generate", "install", "list", "read", "scaffold", "schema", "uninstall", "validate", "write",
    ]);
    expect([...advertisedActions("automad_discover")].sort()).toEqual(["describe", "list"]);
  });

  it("keeps internal, guard-only actions out of the callable set", () => {
    expect(Object.keys(getCapability("automad_pages").actions)).toContain("update_rename");
    expect(callableActions(getCapability("automad_pages")).map(([name]) => name)).not.toContain("update_rename");
    expect(Object.keys(getCapability("automad_site").actions)).toContain("search_replace");
    expect(callableActions(getCapability("automad_site")).map(([name]) => name)).not.toContain("search_replace");
  });

  it("derives write actions from the tool name", () => {
    expect(toolPrefix("automad_pages")).toBe("pages");
    expect(writeActionOf("automad_pages", "delete")).toBe("pages.delete");
    expect(writeActionOf("automad_theme", "build")).toBe("theme.build");
  });

  it("declares a runtime requirement per tool", () => {
    expect(getCapability("automad_pages").requires).toBe("live");
    expect(getCapability("automad_theme").requires).toBe("themes");
    expect(getCapability("automad_docs").requires).toBe("none");
    expect(getCapability("automad_discover").requires).toBe("none");
  });

  it("has descriptions and non-contradictory action flags", () => {
    for (const capability of CAPABILITY_REGISTRY) {
      expect(capability.title.trim()).not.toBe("");
      expect(capability.summary.trim()).not.toBe("");
      expect(capability.description.trim()).not.toBe("");
      for (const action of Object.values(capability.actions)) {
        expect(action.description.trim()).not.toBe("");
        expect(action.readOnly && action.destructive).toBe(false);
      }
    }
    expect(() => validateCapabilityRegistry()).not.toThrow();
  });

  it("looks up known capabilities and rejects unknown names", () => {
    expect(getCapability("automad_theme").title).toBe("Theme");
    expect(() => getCapability("automad_unknown")).toThrow("Unknown capability: automad_unknown");
  });

  it("rejects duplicate names and duplicate prefixes", () => {
    expect(() => validateCapabilityRegistry([...CAPABILITY_REGISTRY, CAPABILITY_REGISTRY[0]!])).toThrow(
      "Duplicate capability name: automad_pages",
    );
    const clashingPrefix = [...CAPABILITY_REGISTRY, { ...CAPABILITY_REGISTRY[0]!, name: "automad_pages" }];
    expect(() => validateCapabilityRegistry(clashingPrefix)).toThrow("Duplicate capability name");
  });

  it("rejects names outside the automad_ namespace", () => {
    expect(() => validateCapabilityRegistry(patched("automad_pages", { name: "pages" }))).toThrow(
      'Capability name must start with "automad_": pages',
    );
  });

  it("rejects contradictory and malformed action flags", () => {
    const contradictory = patched("automad_pages", {
      actions: { ...getCapability("automad_pages").actions, list: { readOnly: true, destructive: true, description: "List" } },
    });
    expect(() => validateCapabilityRegistry(contradictory)).toThrow(
      "Capability action automad_pages.list cannot be both readOnly and destructive",
    );

    const readOnlyInternal = patched("automad_pages", {
      actions: { ...getCapability("automad_pages").actions, peek: { readOnly: true, destructive: false, internal: true, description: "Peek" } },
    });
    expect(() => validateCapabilityRegistry(readOnlyInternal)).toThrow(
      "Internal action automad_pages.peek must not be read-only",
    );
  });

  it("rejects a tool with no callable actions", () => {
    const internalOnly = patched("automad_pages", {
      actions: { update_rename: { readOnly: false, destructive: true, internal: true, description: "Rename" } },
    });
    expect(() => validateCapabilityRegistry(internalOnly)).toThrow(
      "Capability declares no callable actions: automad_pages",
    );
  });

  it("rejects empty router and action descriptions", () => {
    expect(() => validateCapabilityRegistry(patched("automad_pages", { title: "" }))).toThrow(
      "Capability title must not be empty: automad_pages",
    );
    expect(() => validateCapabilityRegistry(patched("automad_pages", { summary: "" }))).toThrow(
      "Capability summary must not be empty: automad_pages",
    );
    expect(() => validateCapabilityRegistry(patched("automad_pages", { description: "" }))).toThrow(
      "Capability description must not be empty: automad_pages",
    );

    const emptyAction = patched("automad_pages", {
      actions: { ...getCapability("automad_pages").actions, list: { ...getCapability("automad_pages").actions.list!, description: "" } },
    });
    expect(() => validateCapabilityRegistry(emptyAction)).toThrow("Capability action description must not be empty: automad_pages.list");
  });
});
