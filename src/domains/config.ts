import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { ConfigInput } from '../schemas.js';
type ConfigAction = 'get' | 'set';
const ACTION_MAP: Record<ConfigAction, WriteAction> = {
  get: 'config.get',
  set: 'config.set',
};
interface BootstrapData {
  version?: string;
  sitename?: string;
  envKeys?: Record<string, unknown>;
  dashboard?: string;
  languages?: Record<string, string>;
  fileTypes?: Record<string, unknown>;
  reservedFields?: Record<string, unknown>;
  text?: Record<string, string>;
}

export async function handleConfig(
  input: ConfigInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const action = input.action;
  const permit = guard.check(ACTION_MAP[action], '/', input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError('FORBIDDEN', permit.reason);
  }
  if (permit.allowed === 'pending') {
    return permit;
  }

  switch (action) {
    case 'get': {
      const data = (await client.get<BootstrapData>(`${API_BASE}/app/bootstrap`)) ?? {};
      // v2's dashboard API exposes no read endpoint for runtime config; the
      // closest authoritative surface is `envKeys` from bootstrap (which the
      // dashboard itself shows on the system-settings page).
      return {
        version: data.version,
        sitename: data.sitename,
        envKeys: data.envKeys ?? {},
        dashboard: data.dashboard,
      };
    }
    case 'set': {
      if (!input.type || !input.payload || Object.keys(input.payload).length === 0) {
        throw new AutomadMcpError('VALIDATION', 'type and payload are required for set (non-empty payload)');
      }
      return client.post(`${API_BASE}/config/update`, { type: input.type, ...input.payload });
    }
  }
}
