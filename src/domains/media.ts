import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { MediaInput } from '../schemas.js';

type MediaAction = MediaInput['action'];

const ACTION_MAP: Record<MediaAction, WriteAction> = {
  list: 'media.list',
  upload: 'media.upload',
  import: 'media.import',
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
      if (!input.source.filename || !input.source.filename.trim()) {
        throw new AutomadMcpError('VALIDATION', 'source.filename must not be empty or whitespace-only');
      }
      if (
        input.source.filename.includes('/') ||
        input.source.filename.includes('\\') ||
        input.source.filename.includes('..')
      ) {
        throw new AutomadMcpError(
          'VALIDATION',
          'source.filename must be a plain file name without path separators',
        );
      }
      if (!input.source.mimeType || !input.source.mimeType.trim()) {
        throw new AutomadMcpError('VALIDATION', 'source.mimeType must not be empty or whitespace-only');
      }
      return client.upload(`${API_BASE}/file-collection/upload`, {
        ...input.source,
        url: input.url ?? '',
      });
    }
    case 'import': {
      if (!input.import_url || !input.import_url.trim()) {
        throw new AutomadMcpError(
          'VALIDATION',
          'import_url is required for import (got empty or whitespace-only)',
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(input.import_url);
      } catch {
        throw new AutomadMcpError('VALIDATION', `import_url is not a valid URL: ${input.import_url}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new AutomadMcpError(
          'VALIDATION',
          `import_url must use http or https: ${input.import_url}`,
        );
      }
      // v2 fetches the file server-side and answers with an empty envelope on
      // success (only `error` is set on failure), so there is no payload to
      // return — report what was asked for instead. The stored file name is
      // deliberately not echoed: v2 sanitizes it without URL-decoding
      // (`Mein%20Logo%20(RGB).svg` → `mein-20logo-20-rgb-.svg`), so anything we
      // derived here would be a guess. Callers read it back with `list`.
      try {
        await client.post(`${API_BASE}/file/import`, {
          importUrl: input.import_url,
          url: input.url ?? '',
        });
      } catch (err) {
        throw asImportError(err, input.import_url);
      }
      return { ok: true, importUrl: input.import_url, url: input.url ?? '' };
    }
    case 'delete': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url (parent directory) is required for delete');
      }
      if (!input.filename || !input.filename.trim()) {
        throw new AutomadMcpError(
          'VALIDATION',
          "filename is required for delete (file name within url's directory)",
        );
      }
      if (
        input.filename.includes('/') ||
        input.filename.includes('\\') ||
        input.filename.includes('..')
      ) {
        throw new AutomadMcpError(
          'VALIDATION',
          'filename must be a plain file name without path separators',
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

/**
 * v2 reports every import failure the same way — HTTP 200 with a terse
 * `error` string — which the generic envelope mapping can only classify as
 * `UNKNOWN`. That tells the model nothing about whether to fix the URL or give
 * up, so translate the two shapes v2 actually produces (live-verified on
 * 2.0.0-beta.51) into codes a caller can act on.
 */
function asImportError(err: unknown, importUrl: string): AutomadMcpError {
  const message = err instanceof Error ? err.message : String(err);
  if (/unsupported file type/i.test(message)) {
    return new AutomadMcpError(
      'VALIDATION',
      `Automad refused the file type of ${importUrl}. The extension must be listed in the site's AM_ALLOWED_FILE_TYPES, and a URL without a file extension is rejected outright.`,
      { importUrl, cause: message },
    );
  }
  if (/import has failed/i.test(message)) {
    return new AutomadMcpError(
      'NETWORK',
      `Automad could not fetch ${importUrl} (unreachable host, non-200 response, or a URL the server cannot resolve). Note the fetch happens on the Automad server, not here.`,
      { importUrl, cause: message },
    );
  }
  return err instanceof AutomadMcpError
    ? err
    : new AutomadMcpError('UNKNOWN', message, { importUrl });
}
