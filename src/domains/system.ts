import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { SystemInput } from '../schemas.js';

type SystemAction = SystemInput['action'];
const ACTION_MAP: Record<SystemAction, WriteAction> = {
  check_for_update: 'system.check_for_update',
  update: 'system.update',
};

export async function handleSystem(
  input: SystemInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'check_for_update':
      return client.post(`${API_BASE}/system/check-for-update`, {});
    case 'update':
      return client.post(`${API_BASE}/system/update`, {});
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown system action: ${String(input.action)}`);
    }
  }
}
