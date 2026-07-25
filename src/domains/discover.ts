import { zodToJsonSchema } from "zod-to-json-schema";
import { AutomadMcpError } from "../errors.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { DiscoverInput } from "../schemas.js";
import { TOOL_INPUT_SCHEMAS } from "../schemas.js";
import {
  CAPABILITY_REGISTRY,
  callableActions,
  getCapability,
  writeActionOf,
} from "../capabilities/registry.js";

type DiscoverAction = DiscoverInput["action"];

const ACTION_MAP: Record<DiscoverAction, WriteAction> = {
  list: "discover.list",
  describe: "discover.describe",
};

/**
 * Discovery facade over the capability registry (inspired by WordPress's
 * mcp-adapter discover/describe pattern): lets an agent enumerate every
 * tool+action and pull one action's input schema on demand, instead of
 * loading every action's details into context up front. Always read-only
 * and works in every mode, including `AUTOMAD_MODE=docs`.
 *
 * Everything it reports — flags, summaries, schemas, runtime requirements — is
 * read from the same registry the server registers tools from and the
 * write-guard enforces, so discovery can't describe a surface that doesn't
 * exist. Internal, guard-only actions are not advertised.
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
          callableActions(cap).map(([action, meta]) => ({
            tool: cap.name,
            action,
            writeAction: writeActionOf(cap.name, action),
            readOnly: meta.readOnly,
            destructive: meta.destructive,
            requires: cap.requires,
            summary: meta.description,
          })),
        ),
      };
    }
    case "describe": {
      if (!input.tool) throw new AutomadMcpError("VALIDATION", "tool is required for describe");
      const capability = getCapability(input.tool);
      const schema = TOOL_INPUT_SCHEMAS[capability.name];
      if (!schema) throw new AutomadMcpError("NOT_FOUND", `No input schema registered for ${input.tool}`);
      let actions = Object.fromEntries(callableActions(capability));
      if (input.target_action) {
        const action = actions[input.target_action];
        if (!action) throw new AutomadMcpError("NOT_FOUND", `Unknown action ${input.tool}.${input.target_action}`);
        actions = { [input.target_action]: action };
      }
      return {
        tool: capability.name,
        title: capability.title,
        summary: capability.summary,
        description: capability.description,
        requires: capability.requires,
        actions,
        inputSchema: zodToJsonSchema(schema, { target: "jsonSchema7" }),
      };
    }
  }
}
