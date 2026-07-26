import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { SiteInput } from '../schemas.js';

type SiteAction = SiteInput['action'];

const ACTION_MAP: Record<SiteAction, WriteAction> = {
  info: 'site.info',
  search: 'site.search',
  health: 'site.health',
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

export async function handleSite(
  input: SiteInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;

  switch (input.action) {
    case 'info': {
      const data = (await client.get<BootstrapData>(`${API_BASE}/app/bootstrap`)) ?? {};
      return {
        version: data.version,
        sitename: data.sitename,
        languages: data.languages ?? {},
        fileTypes: data.fileTypes ?? {},
        reservedFields: data.reservedFields ?? {},
        dashboard: data.dashboard,
      };
    }
    case 'health': {
      const startedAt = Date.now();
      try {
        const data = (await client.get<BootstrapData>(`${API_BASE}/app/bootstrap`)) ?? {};
        return {
          ok: true,
          reachable: true,
          authenticated: true,
          version: data.version,
          sitename: data.sitename,
          latencyMs: Date.now() - startedAt,
        };
      } catch (err) {
        const code = err instanceof AutomadMcpError ? err.code : 'UNKNOWN';
        return {
          ok: false,
          reachable: code !== 'NETWORK',
          authenticated: code !== 'AUTH',
          error: { code, message: err instanceof Error ? err.message : String(err) },
          latencyMs: Date.now() - startedAt,
        };
      }
    }
    case 'search': {
      if (!input.query || !input.query.trim()) {
        throw new AutomadMcpError(
          'VALIDATION',
          'query is required for search (got empty or whitespace-only)',
        );
      }
      // A search with a `replace` is a global mutation across the entire site.
      // In confirm-destructive mode it requires an explicit token (the caller's
      // intent is "search and replace", not "search and read"). Read-only and
      // unrestricted modes pass through unchanged.
      if (input.replace !== undefined) {
        const permit = guard.check('site.search_replace', '/', input.confirm_token);
        if (permit.allowed === 'pending') return permit;
        if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
      }
      if (input.is_regex) {
        try {
          new RegExp(input.query);
        } catch (err) {
          throw new AutomadMcpError(
            'VALIDATION',
            `Invalid regex pattern in query: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const payload: Record<string, unknown> = {
        searchValue: input.query,
        isRegex: input.is_regex ?? false,
        isCaseSensitive: input.is_case_sensitive ?? false,
      };
      if (input.replace !== undefined) payload['replaceValue'] = input.replace;
      return client.post(`${API_BASE}/search/search-replace`, payload);
    }
  }
}
