import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { ImageInput } from '../schemas.js';

type ImageAction = ImageInput['action'];
const ACTION_MAP: Record<ImageAction, WriteAction> = {
  list: 'image.list',
  save: 'image.save',
};

export async function handleImage(
  input: ImageInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'list':
      return client.post(`${API_BASE}/image-collection/list`, {});
    case 'save': {
      if (!input.name) throw new AutomadMcpError('VALIDATION', 'name is required for save');
      if (!input.extension) throw new AutomadMcpError('VALIDATION', 'extension is required for save');
      if (!input.imageBase64) throw new AutomadMcpError('VALIDATION', 'imageBase64 is required for save');
      return client.post(`${API_BASE}/image/save`, {
        name: input.name,
        extension: input.extension,
        imageBase64: input.imageBase64,
      });
    }
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown image action: ${String(input.action)}`);
    }
  }
}
