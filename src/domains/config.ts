import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { ConfigInput } from "../schemas.js";

type ConfigAction = ConfigInput["action"];
const ACTION_MAP: Record<ConfigAction, WriteAction> = {
  get: "config.get",
  set: "config.set",
  validate: "config.validate",
};

export async function handleConfig(
  input: ConfigInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.key ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "get": {
      const res = (await client.get("/dashboard/api/config")) as { config: Record<string, unknown> };
      if (input.key) {
        return { value: getByPath(res.config, input.key) };
      }
      return res;
    }
    case "set": {
      if (!input.key || input.value === undefined) {
        throw new AutomadMcpError("VALIDATION", "key and value required");
      }
      return client.post("/dashboard/api/config", { key: input.key, value: input.value });
    }
    case "validate": {
      return client.get("/dashboard/api/config/validate");
    }
  }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
