import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { AutomadMcpError } from "../errors.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { DiscoverInput } from "../schemas.js";
import { CAPABILITY_REGISTRY, getCapability } from "../capabilities/registry.js";
import { pagesInput, mediaInput, sharedInput, configInput, siteInput, themeInput, docsInput } from "../schemas.js";

type DiscoverAction = DiscoverInput["action"];

const ACTION_MAP: Record<DiscoverAction, WriteAction> = {
  list: "discover.list",
  describe: "discover.describe",
};

/** Tool name → its Zod input schema, for `describe`'s JSON Schema output. */
const INPUT_SCHEMAS: Readonly<Record<string, ZodTypeAny>> = {
  automad_pages: pagesInput,
  automad_media: mediaInput,
  automad_shared: sharedInput,
  automad_config: configInput,
  automad_site: siteInput,
  automad_docs: docsInput,
  automad_theme: themeInput,
};

/**
 * Discovery facade over the capability registry (inspired by WordPress's
 * mcp-adapter discover/describe pattern): lets an agent enumerate every
 * tool+action and pull one action's input schema on demand, instead of
 * loading every action's details into context up front. Always read-only
 * and works in every mode, including `AUTOMAD_MODE=docs`.
 */
export async function handleDiscover(input: DiscoverInput, guard: WriteGuard): Promise<unknown> {
  const target = input.tool ?? "*";
  const permit = guard.check(ACTION_MAP[input.action], target, input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError("FORBIDDEN", permit.reason);

  switch (input.action) {
    case "list": {
      const capabilities = input.tool ? CAPABILITY_REGISTRY.filter((cap) => cap.name === input.tool) : CAPABILITY_REGISTRY;
      if (input.tool && capabilities.length === 0) throw new AutomadMcpError("NOT_FOUND", `Unknown capability: ${input.tool}`);
      return {
        capabilities: capabilities.flatMap((cap) =>
          Object.entries(cap.actions).map(([action, meta]) => ({
            tool: cap.name,
            action,
            readOnly: meta.readOnly,
            destructive: meta.destructive,
            summary: meta.description,
          })),
        ),
      };
    }
    case "describe": {
      if (!input.tool) throw new AutomadMcpError("VALIDATION", "tool is required for describe");
      const capability = getCapability(input.tool);
      const schema = INPUT_SCHEMAS[input.tool];
      if (!schema) throw new AutomadMcpError("NOT_FOUND", `No input schema registered for ${input.tool}`);
      let actions = capability.actions;
      if (input.target_action) {
        const action = capability.actions[input.target_action];
        if (!action) throw new AutomadMcpError("NOT_FOUND", `Unknown action ${input.tool}.${input.target_action}`);
        actions = { [input.target_action]: action };
      }
      return {
        tool: capability.name,
        description: capability.description,
        actions,
        inputSchema: zodToJsonSchema(schema, { target: "jsonSchema7" }),
      };
    }
  }
}
