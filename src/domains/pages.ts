import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import { PageListResponse } from '../schemas.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { PagesInput } from '../schemas.js';
export interface BatchItemResult {
  url: string;
  ok: boolean;
  resultingUrl?: string;
  /** False when the item was saved but is not live (draft, or publishing failed). */
  published?: boolean;
  /** Caller-facing notes, e.g. a publish that did not take effect. */
  warnings?: string[];
  /** Filled when ok=false and the item required a confirm token. */
  confirmToken?: string;
  action?: WriteAction;
  expiresAt?: string;
  /** Structured error (mirrors AutomadMcpError). */
  code?: string;
  message?: string;
  details?: unknown;
  requiresConfirmation?: boolean;
}

type PagesAction = PagesInput['action'];

const ACTION_MAP: Record<PagesAction, WriteAction> = {
  list: 'pages.list',
  get: 'pages.get',
  create: 'pages.create',
  update: 'pages.update',
  delete: 'pages.delete',
  move: 'pages.move',
  duplicate: 'pages.duplicate',
  publish: 'pages.publish',
  batch_update: 'pages.batch_update',
  trash_list: 'pages.trash_list',
  trash_restore: 'pages.trash_restore',
  trash_permanently_delete: 'pages.trash_permanently_delete',
  trash_clear: 'pages.trash_clear',
  history: 'pages.history',
  history_restore: 'pages.history_restore',
  breadcrumbs: 'pages.breadcrumbs',
  publication_state: 'pages.publication_state',
  recent: 'pages.recent',
  discard_draft: 'pages.discard_draft',
};

const READ_RETRY_TOTAL_MS = 3000;
const READ_RETRY_INTERVAL_MS = 200;

function normalizeUrl(url: string): string;
function normalizeUrl(url: string | undefined): string | undefined;
function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url === '/' ? '/' : url.replace(/\/+$/, '');
}
/** What actually became of a publish attempt. `warnings` is caller-facing prose. */
export interface PublishOutcome {
  published: boolean;
  warnings: string[];
}

function describeError(err: unknown): string {
  if (err instanceof AutomadMcpError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Empty the rendered-page cache. Best effort: a write that reached Automad is
 * not undone by a cache that refused to clear, so this reports rather than
 * throws.
 *
 * It is not optional politeness. Automad serves cached HTML and only re-checks
 * for content changes every `AM_CACHE_MONITOR_DELAY` seconds — 120 by default —
 * so without this a visitor can keep getting the old page for two minutes
 * after the tool reported success.
 */
async function clearCache(client: HttpClient, warnings: string[]): Promise<void> {
  try {
    await client.post(`${API_BASE}/cache/clear`, {});
  } catch (err) {
    warnings.push(
      `the page cache could not be cleared (${describeError(err)}); visitors may keep seeing the previous version until Automad re-checks (AM_CACHE_MONITOR_DELAY, 120s by default)`,
    );
  }
}

/**
 * Publish a page and report whether it *actually* became published.
 *
 * The previous version swallowed a failing `page/publish` and returned as if
 * all was well, and then confirmed success by reading `page/data` — which
 * serves drafts too, so it proved nothing. Both together let `create`/`update`
 * report success on a page no visitor could see. The publication state is now
 * read from the endpoint that distinguishes the two, and anything that went
 * wrong travels back to the caller.
 */
async function publishAndWait(
  client: HttpClient,
  inputUrl: string,
  resultingUrl: string,
): Promise<PublishOutcome> {
  const warnings: string[] = [];
  try {
    await client.post(`${API_BASE}/page/publish`, { url: inputUrl });
  } catch (err) {
    warnings.push(
      `saved, but publishing failed (${describeError(err)}) — the page is still a draft and is not visible to visitors. Retry with the \`publish\` action.`,
    );
    return { published: false, warnings };
  }

  for (let i = 0; i < 8 && i * READ_RETRY_INTERVAL_MS < READ_RETRY_TOTAL_MS; i++) {
    await new Promise((r) => setTimeout(r, READ_RETRY_INTERVAL_MS));
    try {
      const state = await client.post<unknown>(`${API_BASE}/page/get-publication-state`, {
        url: resultingUrl,
      });
      if (isRecord(state) && state['isPublished'] === true) {
        await clearCache(client, warnings);
        return { published: true, warnings };
      }
    } catch {
      /* the page may not be queryable yet — keep polling */
    }
  }
  warnings.push(
    `publishing was accepted but ${resultingUrl} is still not reported as published after ${String(READ_RETRY_TOTAL_MS)}ms; check with the \`publication_state\` action`,
  );
  return { published: false, warnings };
}

async function readWithRetry(client: HttpClient, url: string): Promise<unknown> {
  let lastErr: unknown;
  const start = Date.now();
  while (Date.now() - start < READ_RETRY_TOTAL_MS) {
    try {
      return await client.post(`${API_BASE}/page/data`, { url });
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: unknown })?.code;
      if (code !== 'NOT_FOUND') throw err;
      await new Promise((r) => setTimeout(r, READ_RETRY_INTERVAL_MS));
    }
  }
  throw lastErr;
}

export async function handlePages(
  input: PagesInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  if (input.url) input.url = normalizeUrl(input.url);
  if (input.target_url) input.target_url = normalizeUrl(input.target_url);

  if (input.action === 'batch_update') {
    // Per-item confirmation: the outer guard is bypassed because each item has
    // its own (action, target) check inside the loop below.
    return handleBatchUpdate(input, client, guard);
  }
  const actionForGuard: WriteAction =
    input.action === 'update' && input.title !== undefined
      ? 'pages.update_rename'
      : ACTION_MAP[input.action];
  const permit = guard.check(actionForGuard, input.url ?? '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;

  switch (input.action) {
    case 'list': {
      // Must pass a body ({}) so the client attaches __csrf__ + __json__;
      // a body-less POST omits __csrf__ and v2 rejects with "CSRF token mismatch".
      const result = await client.post(`${API_BASE}/page-collection/get-recently-edited`, {});
      return PageListResponse.parse(result);
    }
    case 'get': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required');
      return readWithRetry(client, input.url);
    }
    case 'create': {
      if (!input.title || !input.title.trim()) {
        throw new AutomadMcpError(
          'VALIDATION',
          'title is required for create (got empty or whitespace-only)',
        );
      }
      if (!input.target_url && !input.url) {
        throw new AutomadMcpError('VALIDATION', 'target_url (parent page) is required for create');
      }
      const payload: Record<string, unknown> = {
        targetPage: input.target_url ?? input.url,
        title: input.title,
      };
      if (input.template) payload['theme_template'] = input.template;
      if (input.private !== undefined) payload['private'] = input.private;
      const created = (await client.post(`${API_BASE}/page/add`, payload)) as { redirect?: string };
      const rawSlug = extractSlugFromRedirect(created.redirect);
      const slug = rawSlug
        ? rawSlug.startsWith('/')
          ? rawSlug
          : `/${rawSlug}`
        : input.url;
      const outcome =
        slug && input.publish !== false
          ? await publishAndWait(client, slug, slug)
          : { published: false, warnings: [] };
      return {
        ok: true,
        url: slug,
        published: outcome.published,
        ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
        ...created,
      };
    }
    case 'update': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for update');
      return updateOnePage(client, {
        url: input.url,
        title: input.title,
        template: input.template,
        private: input.private,
        tags: input.tags,
        fields: input.fields,
        publish: input.publish,
      });
    }
    case 'delete': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for delete');
      const deleted = await client.post<unknown>(`${API_BASE}/page/delete`, { url: input.url });
      // Without this the deleted page keeps being served from the cache.
      const warnings: string[] = [];
      await clearCache(client, warnings);
      return isRecord(deleted)
        ? { ...deleted, ...(warnings.length > 0 ? { warnings } : {}) }
        : { ok: true, ...(warnings.length > 0 ? { warnings } : {}) };
    }
    case 'move': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for move');
      if (!input.target_url) {
        throw new AutomadMcpError(
          'VALIDATION',
          'target_url (destination parent page) is required for move',
        );
      }
      const payload: Record<string, unknown> = { url: input.url, targetPage: input.target_url };
      if (input.layout) {
        let parsedLayout: unknown;
        try {
          parsedLayout = JSON.parse(input.layout);
        } catch {
          throw new AutomadMcpError(
            'VALIDATION',
            'layout must be a JSON-encoded array of sibling URLs (got unparseable string)',
          );
        }
        if (!Array.isArray(parsedLayout) || parsedLayout.length === 0) {
          throw new AutomadMcpError(
            'VALIDATION',
            'layout must be a non-empty JSON array of sibling URL strings',
          );
        }
        if (!parsedLayout.every((u: unknown) => typeof u === 'string' && u.startsWith('/'))) {
          throw new AutomadMcpError(
            'VALIDATION',
            'layout must contain only URL strings starting with /',
          );
        }
        payload['layout'] = input.layout;
      }
      return client.post(`${API_BASE}/page/move`, payload);
    }
    case 'duplicate': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for duplicate');
      return client.post(`${API_BASE}/page/duplicate`, { url: input.url });
    }
    case 'publish': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for publish');
      const outcome = await publishAndWait(client, input.url, input.url);
      return {
        ok: outcome.published,
        url: input.url,
        published: outcome.published,
        ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
      };
    }
    case 'trash_list':
      return client.post(`${API_BASE}/page-trash/list`, {});
    case 'trash_restore': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for trash_restore');
      }
      return client.post(`${API_BASE}/page-trash/restore`, {
        path: assertTrashPath(input.url, 'trash_restore'),
      });
    }
    case 'trash_permanently_delete': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for trash_permanently_delete');
      }
      return client.post(`${API_BASE}/page-trash/permanently-delete`, {
        path: assertTrashPath(input.url, 'trash_permanently_delete'),
      });
    }
    case 'trash_clear':
      return client.post(`${API_BASE}/page-trash/clear`, {});
    case 'history': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for history');
      return client.post(`${API_BASE}/history/log`, { url: input.url });
    }
    case 'history_restore': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for history_restore');
      }
      if (!input.history_id) {
        throw new AutomadMcpError('VALIDATION', 'history_id is required for history_restore');
      }
      return client.post(`${API_BASE}/history/restore`, {
        url: input.url,
        logId: input.history_id,
      });
    }
    case 'breadcrumbs': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for breadcrumbs');
      }
      return client.post(`${API_BASE}/page/breadcrumbs`, { url: input.url });
    }
    case 'publication_state': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for publication_state');
      }
      return client.post(`${API_BASE}/page/get-publication-state`, { url: input.url });
    }
    case 'recent':
      return client.post(`${API_BASE}/page-collection/get-recently-edited`, {});
    case 'discard_draft': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for discard_draft');
      }
      return client.post(`${API_BASE}/page/discard-draft`, { url: input.url });
    }
  }
}

/** Apply a batch of page updates with per-item confirmation and structured per-item errors. */
async function handleBatchUpdate(
  input: PagesInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  if (!input.items || input.items.length === 0) {
    throw new AutomadMcpError('VALIDATION', 'items is required for batch_update (non-empty array)');
  }
  const results: BatchItemResult[] = [];
  let allOk = true;
  // Sequential on purpose: v2 races on concurrent title-renames of the same tree.
  for (const rawItem of input.items) {
    const item = { ...rawItem, url: normalizeUrl(rawItem.url) };
    // A title change is effectively a rename (happens during publish). Treat
    // those items as `pages.update_rename` (destructive): in confirm-destructive
    // mode they return a pending token bound to (action, target). Non-rename
    // items use `pages.update` (ordinary write) and run directly. Other write
    // modes (read-only/unrestricted) decide uniformly.
    const itemAction: WriteAction =
      item.title !== undefined ? 'pages.update_rename' : 'pages.update';
    const permit = guard.check(itemAction, item.url, item.confirm_token);
    if (permit.allowed === 'pending') {
      results.push({
        url: item.url,
        ok: false,
        requiresConfirmation: true,
        confirmToken: permit.confirmToken,
        expiresAt: permit.expiresAt,
        action: permit.action,
      });
      allOk = false;
      continue;
    }
    if (permit.allowed === false) {
      results.push({ url: item.url, ok: false, code: 'FORBIDDEN', message: permit.reason });
      allOk = false;
      continue;
    }
    try {
      const res = await updateOnePage(client, item);
      results.push({
        url: item.url,
        ok: true,
        resultingUrl: res.url,
        published: res.published,
        ...(res.warnings ? { warnings: res.warnings } : {}),
      });
    } catch (err) {
      results.push({
        url: item.url,
        ok: false,
        code: err instanceof AutomadMcpError ? err.code : 'UNKNOWN',
        message:
          err instanceof AutomadMcpError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
        ...(err instanceof AutomadMcpError && err.details !== undefined
          ? { details: err.details }
          : {}),
      });
      allOk = false;
    }
  }
  return { ok: allOk, results };
}

interface PageUpdateFields {
  url: string;
  title?: string | undefined;
  template?: string | undefined;
  private?: boolean | undefined;
  tags?: string[] | undefined;
  fields?: Record<string, unknown> | undefined;
  /** Publish after saving (default true). */
  publish?: boolean | undefined;
}

/** v2's trash directory, as it appears in the `path` values `trash_list` returns. */
const TRASH_PATH_MARKER = '/.trash/';

/**
 * Both trash writes address a page by its **trash path** (`Request::post('path')`,
 * e.g. `/.trash/my-page`), not by the URL the page had while it was live. Sent
 * the wrong value, v2 does not complain: `permanently_delete` returns early and
 * `restore` moves an empty path — both answer 200, so the caller is told the
 * work happened. Reject the likely mistake here instead, and say where the
 * right value comes from.
 */
function assertTrashPath(value: string, action: string): string {
  if (!value.includes(TRASH_PATH_MARKER)) {
    throw new AutomadMcpError(
      'VALIDATION',
      `${action} expects the trash path of the page (e.g. "/.trash/my-page"), not its former URL. Take the \`path\` field from \`trash_list\`; got "${value}".`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface StoredPage {
  /** Declared fields plus the `unused` ones, merged into one record. */
  fields: Record<string, unknown>;
  /** The page's `theme_template` id, when it has a usable one. */
  template?: string;
}

/**
 * v2 reports a page's template as an absolute file path
 * (`/app/packages/mcp/cafe/home.php`); `theme_template` expects the id form
 * (`mcp/cafe/home`). Returns undefined when no template is selected — v2 stores
 * that as a path with an empty basename (`…/standard-lite/.php`), which must
 * never be echoed back as if it were a selection.
 */
export function templateIdFromPath(templatePath: unknown): string | undefined {
  if (typeof templatePath !== 'string') return undefined;
  const id = /(?:^|\/)packages\/(.+)\.php$/.exec(templatePath)?.[1];
  if (!id || id.endsWith('/')) return undefined;
  return id;
}

/**
 * Current stored state of a page: the template-declared fields plus the ones v2
 * files under `unused` (anything the active template doesn't declare — v2 sends
 * `[]` there when empty), and the selected template.
 */
async function readStoredPage(client: HttpClient, url: string): Promise<StoredPage> {
  const page = await client.post<unknown>(`${API_BASE}/page/data`, { url });
  if (!isRecord(page)) return { fields: {} };
  const fields = isRecord(page['fields']) ? page['fields'] : {};
  const unused = isRecord(page['unused']) ? page['unused'] : {};
  const template = templateIdFromPath(page['template']);
  return { fields: { ...fields, ...unused }, ...(template ? { template } : {}) };
}

/**
 * Save one page via /_api/page/data, then publish unless `publish === false`.
 *
 * v2's save is a **full replace** and rejects any payload without a `title`
 * ("Title missing!", live-verified on 2.0.0-beta.51). A partial update
 * therefore has to read the current record first and merge the caller's
 * changes on top — otherwise every field the caller didn't mention is dropped.
 *
 * The same applies to the *template*: a save without `theme_template` resets
 * the page to the site default with an empty template name, which v2 then
 * fails to render at all ("Template missing!", HTTP 500). The stored selection
 * is therefore carried forward unless the caller overrides it.
 */
async function updateOnePage(
  client: HttpClient,
  item: PageUpdateFields,
): Promise<{ ok: true; url: string; published: boolean; warnings?: string[] }> {
  const stored = await readStoredPage(client, item.url);
  const data: Record<string, unknown> = { ...stored.fields };
  if (item.title !== undefined) {
    if (!item.title.trim()) {
      throw new AutomadMcpError(
        'VALIDATION',
        `title cannot be empty or whitespace-only for ${item.url}`,
      );
    }
    data['title'] = item.title;
  }
  if (item.private !== undefined) data['private'] = item.private;
  if (item.tags !== undefined)
    data['tags'] = item.tags.map((t) => t.trim()).filter(Boolean).join(',');
  if (item.fields) Object.assign(data, item.fields);
  const title = data['title'];
  if (typeof title !== 'string' || !title.trim()) {
    // Only reachable when the stored record has no usable title (e.g. the read
    // was served by a stub). v2 would answer "Title missing!" — say so first.
    throw new AutomadMcpError(
      'VALIDATION',
      `cannot update ${item.url}: the page has no title and none was supplied (v2 requires one on every save)`,
    );
  }
  const payload: Record<string, unknown> = { url: item.url, data };
  const template = item.template ?? stored.template;
  if (template) payload['theme_template'] = template;
  const saved = (await client.post(`${API_BASE}/page/data`, payload)) as { slug?: string };
  const resultingUrl = saved.slug
    ? saved.slug.startsWith('/')
      ? saved.slug
      : `/${saved.slug}`
    : item.url;
  const outcome =
    item.publish !== false
      ? await publishAndWait(client, item.url, resultingUrl)
      : { published: false, warnings: [] };
  return {
    ok: true,
    url: resultingUrl,
    published: outcome.published,
    ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
  };
}

function extractSlugFromRedirect(redirect: string | undefined): string | undefined {
  if (!redirect) return undefined;
  const m = /[?&]url=([^&]+)/.exec(redirect);
  if (!m || !m[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}
