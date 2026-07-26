import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { MediaInput } from '../schemas.js';

type MediaAction = MediaInput['action'];

const ACTION_MAP: Record<MediaAction, WriteAction> = {
  list: 'media.list',
  upload: 'media.upload',
  delete: 'media.delete',
};

export async function handleMedia(
  input: MediaInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.url ?? '/', input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError('FORBIDDEN', permit.reason);
  }
  if (permit.allowed === 'pending') {
    return permit;
  }

  switch (input.action) {
    case 'list': {
      return client.post(`${API_BASE}/file-collection/list`, { url: input.url ?? '' });
    }
    case 'upload': {
      if (!input.source) {
        throw new AutomadMcpError('VALIDATION', 'source is required for upload');
      }
      return client.upload(`${API_BASE}/file-collection/upload`, {
        ...input.source,
        url: input.url ?? '',
      });
    }
    case 'delete': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url (parent directory) is required for delete');
      }
      if (!input.filename) {
        throw new AutomadMcpError(
          'VALIDATION',
          "filename is required for delete (file name within url's directory)",
        );
      }
      // v2's file-collection/list endpoint handles multi-file delete via a
      // `{filename: true}` map. We pass a single entry for one file.
      return client.post(`${API_BASE}/file-collection/list`, {
        url: input.url,
        action: 'delete',
        selected: { [input.filename]: true },
      });
    }
  }
}
