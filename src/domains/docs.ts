import { AutomadMcpError } from '../errors.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { DocsInput } from '../schemas.js';
import { getDoc, listDocs, searchDocs } from '../docs/kb.js';

type DocsAction = DocsInput['action'];

const ACTION_MAP: Record<DocsAction, WriteAction> = {
  list: 'docs.list',
  search: 'docs.search',
  get: 'docs.get',
};

/**
 * Documentation router: offline, bundled Automad v2 knowledge base. Works in
 * every mode (including `AUTOMAD_MODE=docs`) with no live instance. All actions
 * are read-only.
 */
export async function handleDocs(input: DocsInput, guard: WriteGuard): Promise<unknown> {
  const target = input.slug ?? input.query ?? '*';
  const permit = guard.check(ACTION_MAP[input.action], target, input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);

  switch (input.action) {
    case 'list':
      return { pages: listDocs() };
    case 'search': {
      if (!input.query) throw new AutomadMcpError('VALIDATION', 'query is required for search');
      return { query: input.query, results: searchDocs(input.query, input.limit) };
    }
    case 'get': {
      if (!input.slug) throw new AutomadMcpError('VALIDATION', 'slug is required for get');
      return getDoc(input.slug);
    }
  }
}
