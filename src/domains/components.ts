import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { ComponentsInput } from '../schemas.js';

type ComponentsAction = ComponentsInput['action'];
const ACTION_MAP: Record<ComponentsAction, WriteAction> = {
  data: 'components.data',
  discard_draft: 'components.discard_draft',
  publication_state: 'components.publication_state',
  publish: 'components.publish',
};

export async function handleComponents(
  input: ComponentsInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const target = input.url ?? '/';
  const permit = guard.check(ACTION_MAP[input.action], target, input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'data':
      // Deliberately body-less. `component/data` is two endpoints wearing one
      // name: hand it a `components` array and it *saves* that array as the
      // draft component store; omit it and it reads. Sending `components: []`
      // — which is what an absent argument used to produce — therefore wiped
      // the site's components while presenting itself as a read, and being
      // flagged read-only meant the write guard let it through in every mode.
      // Saving components is not exposed; reading is.
      return client.post(`${API_BASE}/component/data`, {});
    case 'discard_draft': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for discard_draft');
      return client.post(`${API_BASE}/component/discard-draft`, { url: input.url });
    }
    case 'publication_state': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for publication_state');
      return client.post(`${API_BASE}/component/get-publication-state`, { url: input.url });
    }
    case 'publish': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for publish');
      return client.post(`${API_BASE}/component/publish`, { url: input.url });
    }
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown components action: ${String(input.action)}`);
    }
  }
}
