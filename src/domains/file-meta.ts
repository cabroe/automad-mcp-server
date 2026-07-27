import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { FileMetaInput } from '../schemas.js';

type FileMetaAction = FileMetaInput['action'];
const ACTION_MAP: Record<FileMetaAction, WriteAction> = {
  edit_info: 'file_meta.edit_info',
};

export async function handleFileMeta(
  input: FileMetaInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const target = input.url ?? input.old_name ?? '/';
  const permit = guard.check(ACTION_MAP[input.action], target, input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'edit_info': {
      if (!input.new_name) {
        throw new AutomadMcpError('VALIDATION', 'new_name is required for edit_info');
      }
      if (!input.old_name) {
        throw new AutomadMcpError('VALIDATION', 'old_name is required for edit_info');
      }
      const body: Record<string, unknown> = {
        'new-name': input.new_name,
        'old-name': input.old_name,
        // v2 derives the directory from `url` and looks for the file there.
        // Without it the lookup lands in the wrong directory and v2 answers
        // with a misleading "Permissions denied".
        url: input.url ?? '',
      };
      if (input.caption !== undefined) body['caption'] = input.caption;
      return client.post(`${API_BASE}/file/edit-info`, body);
    }
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown file_meta action: ${String(input.action)}`);
    }
  }
}
