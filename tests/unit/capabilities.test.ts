import { describe, expect, it } from "vitest";
import {
  CAPABILITY_REGISTRY,
  getCapability,
  validateCapabilityRegistry,
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

describe("capability registry", () => {
  it("contains exactly the public routers and their actions", () => {
    expect(CAPABILITY_REGISTRY.map((entry) => entry.name)).toEqual(expectedNames);
    expect(Object.keys(getCapability("automad_pages").actions).sort()).toEqual([
      "batch_update", "create", "delete", "duplicate", "get", "list", "move", "publish", "update",
    ]);
    expect(Object.keys(getCapability("automad_theme").actions)).toContain("schema");
    expect(Object.keys(getCapability("automad_media").actions).sort()).toEqual(["delete", "list", "upload"]);
    expect(Object.keys(getCapability("automad_shared").actions).sort()).toEqual(["get", "set"]);
    expect(Object.keys(getCapability("automad_config").actions).sort()).toEqual(["get", "set"]);
    expect(Object.keys(getCapability("automad_site").actions).sort()).toEqual(["health", "info", "search"]);
    expect(Object.keys(getCapability("automad_docs").actions).sort()).toEqual(["get", "list", "search"]);
    expect(Object.keys(getCapability("automad_theme").actions).sort()).toEqual([
      "activate", "analyze", "build", "diff", "files", "generate", "install", "list", "read", "scaffold", "schema", "uninstall", "validate", "write",
    ]);
    expect(Object.keys(getCapability("automad_discover").actions).sort()).toEqual(["describe", "list"]);
  });

  it("has descriptions and non-contradictory action flags", () => {
    for (const capability of CAPABILITY_REGISTRY) {
      expect(capability.title.trim()).not.toBe("");
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

  it("rejects duplicate and missing capabilities", () => {
    expect(() => validateCapabilityRegistry([...CAPABILITY_REGISTRY, CAPABILITY_REGISTRY[0]!])).toThrow(
      "Duplicate capability name: automad_pages",
    );
    expect(() => validateCapabilityRegistry(CAPABILITY_REGISTRY.filter((entry) => entry.name !== "automad_theme"))).toThrow(
      "Missing capability: automad_theme",
    );
  });

  it("rejects unexpected actions and contradictory flags", () => {
    const extraAction = CAPABILITY_REGISTRY.map((entry) =>
      entry.name === "automad_pages"
        ? { ...entry, actions: { ...entry.actions, archive: { readOnly: true, destructive: false, description: "Archive" } } }
        : entry,
    );
    expect(() => validateCapabilityRegistry(extraAction)).toThrow("Unexpected action automad_pages.archive");

    const contradictory = CAPABILITY_REGISTRY.map((entry) =>
      entry.name === "automad_pages"
        ? { ...entry, actions: { ...entry.actions, list: { readOnly: true, destructive: true, description: "List" } } }
        : entry,
    );
    expect(() => validateCapabilityRegistry(contradictory)).toThrow(
      "Capability action automad_pages.list cannot be both readOnly and destructive",
    );
  });

  it("rejects empty router and action descriptions", () => {
    const emptyTitle = CAPABILITY_REGISTRY.map((entry) =>
      entry.name === "automad_pages" ? { ...entry, title: "" } : entry,
    );
    expect(() => validateCapabilityRegistry(emptyTitle)).toThrow("Capability title must not be empty: automad_pages");

    const emptyAction = CAPABILITY_REGISTRY.map((entry) =>
      entry.name === "automad_pages"
        ? { ...entry, actions: { ...entry.actions, list: { ...entry.actions.list, description: "" } } }
        : entry,
    );
    expect(() => validateCapabilityRegistry(emptyAction)).toThrow("Capability action description must not be empty: automad_pages.list");
  });
});
