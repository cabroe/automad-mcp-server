import { AutomadMcpError } from "../errors.js";
import { API_BASE } from "../config.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { SharedInput } from "../schemas.js";

type SharedAction = SharedInput["action"];

const ACTION_MAP: Record<SharedAction, WriteAction> = {
  get: "shared.get",
  set: "shared.set",
};

export async function handleShared(
  input: SharedInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "get":
      return client.post(`${API_BASE}/shared/data`, {});
    case "set": {
      if (!input.fields) {
        throw new AutomadMcpError("VALIDATION", "fields is required for set");
      }
      return client.post(`${API_BASE}/shared/data`, { data: input.fields });
    }
  }
}
