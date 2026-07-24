import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { MediaInput } from "../schemas.js";

type MediaAction = MediaInput["action"];

const ACTION_MAP: Record<MediaAction, WriteAction> = {
  list: "media.list",
  get: "media.get",
  upload: "media.upload",
  delete: "media.delete",
  rename: "media.rename",
};

export async function handleMedia(
  input: MediaInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/media");
    case "get": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.get("/dashboard/api/media?path=" + encodeURIComponent(input.path));
    }
    case "upload": {
      if (!input.source) throw new AutomadMcpError("VALIDATION", "source is required for upload");
      return client.uploadMultipart("/dashboard/api/media", input.source);
    }
    case "delete": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.delete("/dashboard/api/media?path=" + encodeURIComponent(input.path));
    }
    case "rename": {
      if (!input.path || !input.new_name) {
        throw new AutomadMcpError("VALIDATION", "path and new_name required");
      }
      return client.post("/dashboard/api/media/rename", {
        path: input.path,
        new_name: input.new_name,
      });
    }
  }
}
