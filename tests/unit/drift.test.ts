import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  CAPABILITY_REGISTRY,
  advertisedActions,
  callableActions,
  getCapability,
  toolPrefix,
  writeActionOf,
  TOOL_NAMES,
  validateCapabilityRegistry,
  type ToolName,
} from "../../src/capabilities/registry.js";
import { TOOL_BINDINGS, validateToolBindings } from "../../src/capabilities/tools.js";
import { TOOL_INPUT_SCHEMAS } from "../../src/schemas.js";
import { READ_ACTIONS, DESTRUCTIVE_ACTIONS, WriteGuard } from "../../src/write-guard.js";
import type { Config } from "../../src/config.js";
import { handleDiscover } from "../../src/domains/discover.js";

/**
 * The capability registry is the single source of truth: the write-guard sets,
 * the Zod `action` enums, the MCP tool bindings and the discovery facade are all
 * derived from it. These tests pin the derivations TypeScript can't check at
 * runtime — a Zod enum's actual values, the guard's actual sets, and the guard's
 * actual behavior for every action the registry declares.
 */

function config(writeMode: Config["writeMode"]): Config {
  return {
    mode: "docs",
    url: "",
    username: "",
    password: "",
    writeMode,
    logLevel: "silent",
    liveEnabled: false,
    requestTimeoutMs: 0,
  };
}

/** The literal values a tool's Zod `action` enum accepts. */
function schemaActions(tool: ToolName): string[] {
  const schema = TOOL_INPUT_SCHEMAS[tool];
  expect(schema, `no input schema registered for ${tool}`).toBeDefined();
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const action = shape.action;
  expect(action, `${tool} has no action field`).toBeInstanceOf(z.ZodEnum);
  return [...(action as z.ZodEnum<[string, ...string[]]>).options];
}

describe("registry → derived surfaces", () => {
  it("validates at boot", () => {
    expect(() => validateCapabilityRegistry()).not.toThrow();
    expect(() => validateToolBindings()).not.toThrow();
  });

  it("every tool has a binding and an input schema", () => {
    expect([...TOOL_NAMES].sort()).toEqual(CAPABILITY_REGISTRY.map((cap) => cap.name).sort());
    for (const name of TOOL_NAMES) {
      expect(TOOL_BINDINGS[name].name, `binding missing for ${name}`).toBe(name);
      expect(TOOL_BINDINGS[name].inputSchema).toBe(TOOL_INPUT_SCHEMAS[name]);
    }
  });

  it("each tool's Zod action enum matches its advertised registry actions", () => {
    for (const name of TOOL_NAMES) {
      expect(schemaActions(name), `action enum drift in ${name}`).toEqual([...advertisedActions(name)]);
    }
  });

  it("READ_ACTIONS is exactly the registry's read-only actions", () => {
    const expected = new Set<string>();
    for (const cap of CAPABILITY_REGISTRY) {
      for (const [action, meta] of Object.entries(cap.actions)) {
        if (meta.readOnly) expected.add(writeActionOf(cap.name, action));
      }
    }
    expect([...READ_ACTIONS].sort()).toEqual([...expected].sort());
  });

  it("DESTRUCTIVE_ACTIONS is exactly the registry's destructive actions", () => {
    const expected = new Set<string>();
    for (const cap of CAPABILITY_REGISTRY) {
      for (const [action, meta] of Object.entries(cap.actions)) {
        if (meta.destructive) expected.add(writeActionOf(cap.name, action));
      }
    }
    expect([...DESTRUCTIVE_ACTIONS].sort()).toEqual([...expected].sort());
  });

  it("no action is both read-only and destructive, and every write action is prefixed by its tool", () => {
    for (const cap of CAPABILITY_REGISTRY) {
      for (const [action, meta] of Object.entries(cap.actions)) {
        const writeAction = writeActionOf(cap.name, action);
        expect(writeAction).toBe(`${toolPrefix(cap.name)}.${action}`);
        expect(READ_ACTIONS.has(writeAction) && DESTRUCTIVE_ACTIONS.has(writeAction)).toBe(false);
        expect(READ_ACTIONS.has(writeAction)).toBe(meta.readOnly);
        expect(DESTRUCTIVE_ACTIONS.has(writeAction)).toBe(meta.destructive);
      }
    }
  });
});

describe("internal (guard-only) actions", () => {
  const internal = CAPABILITY_REGISTRY.flatMap((cap) =>
    Object.entries(cap.actions)
      .filter(([, meta]) => meta.internal)
      .map(([action]) => ({ tool: cap.name, action, writeAction: writeActionOf(cap.name, action) })),
  );

  it("covers the two fine-grained confirmation cases", () => {
    // pages.update_rename fires when an update carries a title change;
    // site.search_replace fires when site.search is given a `replace` value.
    expect(internal.map((entry) => entry.writeAction).sort()).toEqual(["pages.update_rename", "site.search_replace"]);
  });

  it("are destructive and never advertised", () => {
    for (const entry of internal) {
      expect(DESTRUCTIVE_ACTIONS.has(entry.writeAction)).toBe(true);
      expect(READ_ACTIONS.has(entry.writeAction)).toBe(false);
      expect(schemaActions(entry.tool as ToolName)).not.toContain(entry.action);
      expect(callableActions(getCapability(entry.tool)).map(([name]) => name)).not.toContain(entry.action);
    }
  });

  it("are hidden from the discovery facade", async () => {
    const guard = new WriteGuard(config("unrestricted"));
    const listed = (await handleDiscover({ action: "list" }, guard)) as { capabilities: { action: string }[] };
    for (const entry of internal) {
      expect(listed.capabilities.map((cap) => cap.action)).not.toContain(entry.action);
    }
    const described = (await handleDiscover({ action: "describe", tool: "automad_pages" }, guard)) as {
      actions: Record<string, unknown>;
    };
    expect(Object.keys(described.actions)).not.toContain("update_rename");
  });
});

describe("registry flags drive real guard behavior", () => {
  it("read-only mode allows exactly the read actions", () => {
    const guard = new WriteGuard(config("read-only"));
    for (const cap of CAPABILITY_REGISTRY) {
      for (const [action, meta] of Object.entries(cap.actions)) {
        const permit = guard.check(writeActionOf(cap.name, action), "/target");
        expect(permit.allowed, `${cap.name}.${action}`).toBe(meta.readOnly);
      }
    }
  });

  it("confirm-destructive mode asks for a token exactly for the registry's destructive actions", () => {
    const guard = new WriteGuard(config("confirm-destructive"));
    for (const cap of CAPABILITY_REGISTRY) {
      for (const [action, meta] of Object.entries(cap.actions)) {
        const permit = guard.check(writeActionOf(cap.name, action), "/target");
        expect(permit.allowed, `${cap.name}.${action}`).toBe(meta.destructive ? "pending" : true);
      }
    }
  });
});
