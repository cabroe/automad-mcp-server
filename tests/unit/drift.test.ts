import { describe, it, expect } from "vitest";
import { CAPABILITY_REGISTRY, EXPECTED_ACTIONS, validateCapabilityRegistry, WRITE_ACTION_PREFIX } from "../../src/capabilities/registry.js";
import { READ_ACTIONS, DESTRUCTIVE_ACTIONS } from "../../src/write-guard.js";

/**
 * Regression guard: every action declared in the capability registry must also
 * exist in the WriteAction union (and vice versa), with consistent read-only /
 * destructive classification. If you add a new action, both files must agree.
 */

// Internal actions exist for fine-grained confirmation: pages.update_rename is
// fired by the domain handler only when an update carries a title change
// (which is effectively a rename). It does not appear in the public registry.
const INTERNAL_ACTIONS = new Set(["pages.update_rename"]);

describe("registry ↔ write-guard drift", () => {
  it("validateCapabilityRegistry passes", () => {
    expect(() => validateCapabilityRegistry()).not.toThrow();
  });

  it("every registry action is declared as a WriteAction", () => {
    const missing: string[] = [];
    for (const cap of CAPABILITY_REGISTRY) {
      const prefix = WRITE_ACTION_PREFIX[cap.name];
      expect(prefix, `registry tool ${cap.name} has no prefix mapping`).toBeTruthy();
      const expected = EXPECTED_ACTIONS[cap.name] ?? [];
      for (const actionName of Object.keys(cap.actions)) {
        const full = `${prefix}.${actionName}`;
        if (!expected.includes(actionName)) missing.push(`${full}: in registry but missing from EXPECTED_ACTIONS`);
      }
    }
    expect(missing, missing.join("; ")).toEqual([]);
  });

  it("every EXPECTED_ACTIONS entry has a matching registry action", () => {
    const extra: string[] = [];
    for (const cap of CAPABILITY_REGISTRY) {
      const expected = EXPECTED_ACTIONS[cap.name] ?? [];
      const actual = Object.keys(cap.actions);
      for (const action of expected) {
        if (!actual.includes(action)) extra.push(`${cap.name}.${action}: in EXPECTED_ACTIONS but missing from registry`);
      }
    }
    expect(extra, extra.join("; ")).toEqual([]);
  });

  it("destructive registry actions are listed in DESTRUCTIVE_ACTIONS", () => {
    const missing: string[] = [];
    for (const cap of CAPABILITY_REGISTRY) {
      const prefix = WRITE_ACTION_PREFIX[cap.name];
      for (const [actionName, meta] of Object.entries(cap.actions)) {
        if (meta.destructive && !DESTRUCTIVE_ACTIONS.has(`${prefix}.${actionName}` as never)) {
          missing.push(`${prefix}.${actionName}`);
        }
      }
    }
    expect(missing, `destructive actions missing from DESTRUCTIVE_ACTIONS: ${missing.join(", ")}`).toEqual([]);
  });

  it("read-only registry actions are listed in READ_ACTIONS", () => {
    const missing: string[] = [];
    for (const cap of CAPABILITY_REGISTRY) {
      const prefix = WRITE_ACTION_PREFIX[cap.name];
      for (const [actionName, meta] of Object.entries(cap.actions)) {
        if (meta.readOnly && !READ_ACTIONS.has(`${prefix}.${actionName}` as never)) {
          missing.push(`${prefix}.${actionName}`);
        }
      }
    }
    expect(missing, `read-only actions missing from READ_ACTIONS: ${missing.join(", ")}`).toEqual([]);
  });

  it("read-only/destructive flags match the write-guard sets", () => {
    const misclassified: string[] = [];
    for (const cap of CAPABILITY_REGISTRY) {
      const prefix = WRITE_ACTION_PREFIX[cap.name];
      for (const [actionName, meta] of Object.entries(cap.actions)) {
        const full = `${prefix}.${actionName}`;
        const isRead = READ_ACTIONS.has(full as never);
        const isDest = DESTRUCTIVE_ACTIONS.has(full as never);
        if (isRead !== meta.readOnly) misclassified.push(`${full}: READ_ACTIONS=${isRead} but registry readOnly=${meta.readOnly}`);
        if (isDest !== meta.destructive) misclassified.push(`${full}: DESTRUCTIVE_ACTIONS=${isDest} but registry destructive=${meta.destructive}`);
      }
    }
    expect(misclassified, misclassified.join("; ")).toEqual([]);
  });

  it("internal page.update_rename is in DESTRUCTIVE_ACTIONS but not in the registry", () => {
    expect(DESTRUCTIVE_ACTIONS.has("pages.update_rename" as never)).toBe(true);
    expect(READ_ACTIONS.has("pages.update_rename" as never)).toBe(false);
    for (const cap of CAPABILITY_REGISTRY) {
      expect(Object.keys(cap.actions)).not.toContain("update_rename");
    }
  });

  it("every action listed in INTERNAL_ACTIONS is documented", () => {
    // If you add a new internal action, add it here AND in write-guard.ts.
    expect(INTERNAL_ACTIONS.has("pages.update_rename")).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has("pages.update_rename" as never)).toBe(true);
  });
});
