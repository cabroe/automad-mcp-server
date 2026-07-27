#!/usr/bin/env node
/**
 * Fernsteuerungs-Matrix für den MCP-Server.
 *
 * Pro advertised Action wird genau ein MCP-Call per Streamable-HTTP
 * abgesetzt — exakt so, wie ein AI-Client es tun würde. Jeder Call
 * startet einen frischen Server-Prozess auf eigenem Port.
 *
 * Usage: node scripts/smoke-matrix.mjs
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TOOL_INPUT_SCHEMAS } from '../dist/schemas.js';
import { CAPABILITY_REGISTRY } from '../dist/capabilities/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

if (existsSync(`${ROOT}/.env.e2e`) && !process.env['AUTOMAD_E2E_URL']) {
  for (const line of readFileSync(`${ROOT}/.env.e2e`, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const E2E_URL = process.env['AUTOMAD_E2E_URL'];
const E2E_USER = process.env['AUTOMAD_E2E_USER'];
const E2E_PASS = process.env['AUTOMAD_E2E_PASS'];
const THEMES_PATH = process.env['AUTOMAD_THEMES_PATH'] ?? `${ROOT}/automad-themes`;
if (!E2E_URL || !E2E_USER || !E2E_PASS) {
  console.error('FATAL: AUTOMAD_E2E_URL / _USER / _PASS nicht gesetzt. e2e:up laufen lassen.');
  process.exit(1);
}

const REQUIRED = {
  'automad_pages.get': ['url'],
  'automad_pages.create': ['title', 'target_url'],
  'automad_pages.update': ['url'],
  'automad_pages.delete': ['url'],
  'automad_pages.move': ['url', 'target_url'],
  'automad_pages.duplicate': ['url'],
  'automad_pages.publish': ['url'],
  'automad_pages.trash_restore': ['url'],
  'automad_pages.trash_permanently_delete': ['url'],
  'automad_pages.history': ['url'],
  'automad_pages.history_restore': ['url', 'history_id'],
  'automad_pages.breadcrumbs': ['url'],
  'automad_pages.publication_state': ['url'],
  'automad_pages.discard_draft': ['url'],
  'automad_pages.batch_update': ['items'],
  'automad_media.upload': ['url', 'name', 'source'],
  'automad_media.delete': ['url'],
  'automad_media.import': ['url', 'source'],
  'automad_shared.set': ['fields'],
  'automad_config.set': ['type', 'payload'],
  'automad_site.search': ['query'],
  'automad_docs.get': ['slug'],
  'automad_docs.search': ['query'],
  'automad_theme.scaffold': ['name'],
  'automad_theme.install': ['source'],
  'automad_theme.activate': ['theme'],
  'automad_theme.uninstall': ['theme'],
  'automad_theme.update': ['package'],
  'automad_theme.build': ['theme'],
  'automad_theme.dev': ['theme'],
  'automad_theme.dev_stop': ['theme'],
  'automad_theme.dev_status': ['theme'],
  'automad_theme.read': ['theme', 'path'],
  'automad_theme.write': ['theme', 'path', 'content'],
  'automad_theme.files': ['theme'],
  'automad_theme.analyze': ['theme'],
  'automad_theme.validate': ['theme'],
  'automad_theme.schema': ['theme'],
  'automad_theme.diff': ['theme', 'path', 'content'],
  'automad_image.save': ['url', 'name', 'extension', 'imageBase64'],
  'automad_components.data': ['url'],
  'automad_components.publication_state': ['url'],
  'automad_components.publish': ['url', 'components'],
  'automad_components.discard_draft': ['url'],
  'automad_mail.save': ['transport', 'from'],
  'automad_mail.test': ['to'],
  'automad_system.update': ['package'],
  'automad_file_meta.edit_info': ['url', 'old_name', 'new_name'],
  'automad_discover.describe': ['tool'],
};

const SEEDS = {
  'automad_pages.create': { publish: true },
  'automad_pages.update': { data: { title: `Smoke ${Date.now().toString(36)}` } },
  'automad_pages.move': { layout: '["/"]' },
  'automad_pages.batch_update': { items: [{ url: '/', data: { title: 'Smoke Batch' } }] },
  'automad_pages.history_restore': { history_id: '0' },
  'automad_pages.trash_restore': { url: '/.trash/never-existed' },
  'automad_pages.trash_permanently_delete': { url: '/.trash/never-existed' },
  'automad_media.upload': (() => {
    const name = `smoke-${Date.now().toString(36)}`;
    return {
      source: {
        filename: `${name}.png`,
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    };
  })(),
  'automad_media.import': { import_url: 'https://example.com/' },
  'automad_media.delete': { filename: '__dynamic__' },
  'automad_shared.set': { fields: { smoke_key: 'smoke_value' } },
  'automad_config.set': { type: 'sessionCookieSalt', payload: { value: 'smoke-salt' } },
  'automad_site.search': { query: 'smoke' },
  'automad_docs.search': { query: 'page' },
  'automad_docs.get': { slug: 'template-syntax' },
  'automad_theme.scaffold': { author: 'Smoke' },
  'automad_theme.install': { source: 'automad/standard-lite' },
  'automad_theme.update': { package: 'automad/standard-lite' },
  'automad_theme.read': { path: 'theme.json' },
  'automad_theme.write': { path: 'README.md', content: '# Smoke\n' },
  'automad_theme.diff': { path: 'theme.json', content: '{\n  "title": "Smoke"\n}' },
  'automad_theme.generate': { kind: 'snippet', name: 'header' },
  'automad_media.import': { import_url: 'https://placehold.co/100x100.png' },
  'automad_components.publish': { components: [] },
  'automad_mail.save': {
    transport: 'smtp',
    from: 'smoke@example.com',
    host: 'smtp.example.com',
    port: 587,
    user: 'smoke',
    password: 'smoke',
    encryption: 'tls',
  },
  'automad_mail.test': { to: 'test@example.com' },
  // edit_info is handled dynamically: we list files at / and pick one
  // that still exists, otherwise skip the action with an explanation.
  'automad_file_meta.edit_info': { url: '/', old_name: '__lookup__', new_name: `smoke-renamed-${Date.now().toString(36)}.png` },
  'automad_discover.describe': { tool: 'automad_pages' },
};

const PROVIDES = {
  'automad_theme.scaffold': 'themeSlug',
};

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function defaultFor(s, fieldName) {
  if (s.$ref) return null;
  if (s.enum) {
    if (s.enum.includes('list')) return 'list';
    if (s.enum.includes('describe')) return 'describe';
    return s.enum[0];
  }
  if (s.const !== undefined) return s.const;
  switch (s.type) {
    case 'string': {
      const n = (fieldName ?? '').toLowerCase();
      if (n === 'url' || n === 'target_url' || n === 'context' || n === 'parent') return '/';
      if (n === 'name' || n === 'old_name' || n === 'new_name') return `smoke-${Date.now().toString(36)}`;
      if (n === 'slug') return 'template-syntax';
      if (n === 'title') return `Smoke ${Date.now().toString(36)}`;
      if (n === 'source') return TINY_PNG;
      if (n === 'imagebase64') return TINY_PNG;
      if (n === 'package') return 'automad/standard-lite';
      if (n === 'theme') return '_';
      if (n === 'path') return '/smoke.png';
      if (n === 'extension') return 'png';
      if (n === 'query') return 'smoke';
      if (n === 'to') return 'test@example.com';
      if (n === 'from') return 'smoke@example.com';
      if (n === 'transport') return 'smtp';
      if (n === 'history_id' || n === 'revision') return 0;
      if (n === 'data') return { key: 'smoke' };
      if (n === 'fields') return { key: 'smoke' };
      if (s.format === 'uri' || s.format === 'url') return 'https://example.com/x.png';
      if (s.format === 'email') return 'test@example.com';
      if (s.format === 'date-time') return new Date().toISOString();
      if (s.minLength && s.minLength > 1) return 'x'.repeat(Math.max(s.minLength, 1));
      return 'smoke';
    }
    case 'number':
    case 'integer':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return false;
    case 'array':
      return [defaultFor(s.items, fieldName)];
    case 'object': {
      if (s.additionalProperties && Object.keys(s.properties ?? {}).length === 0) {
        return { key: 'smoke' };
      }
      const out = {};
      for (const [k, p] of Object.entries(s.properties ?? {})) out[k] = defaultFor(p, k);
      return out;
    }
    default:
      return 'smoke';
  }
}

const toolSchemas = {};
for (const tool of Object.keys(TOOL_INPUT_SCHEMAS)) {
  const s = zodToJsonSchema(TOOL_INPUT_SCHEMAS[tool], { target: 'jsonSchema7' });
  s._toolName = tool;
  const resolveRefs = (sub) => {
    if (!sub || typeof sub !== 'object') return sub;
    if (sub.$ref) {
      const path = sub.$ref.replace(/^#\//, '').split('/');
      let node = s;
      for (const seg of path) node = node?.[seg];
      return resolveRefs(node);
    }
    if (sub.properties) {
      const out = { ...sub };
      out.properties = {};
      for (const [k, v] of Object.entries(sub.properties)) out.properties[k] = resolveRefs(v);
      return out;
    }
    if (sub.items) return { ...sub, items: resolveRefs(sub.items) };
    return sub;
  };
  toolSchemas[tool] = resolveRefs(s);
}

function buildArgs(toolName, action) {
  const toolSchema = toolSchemas[toolName];
  const props = toolSchema.properties ?? {};
  const required = REQUIRED[`${toolName}.${action}`] ?? [];
  const out = {};
  for (const field of required) {
    if (props[field]) {
      out[field] = defaultFor(props[field], field);
    } else {
      out[field] = defaultFor({ type: 'string' }, field);
    }
  }
  return out;
}

const USED_PORTS = new Set();

async function callOnce(tool, action, args) {
  let port;
  for (let i = 0; i < 200; i++) {
    port = 53700 + Math.floor(Math.random() * 1000);
    if (!USED_PORTS.has(port)) break;
  }
  USED_PORTS.add(port);
  const token = `smoke-${randomUUID()}`;
  const child = spawn('node', [`${ROOT}/dist/index.js`], {
    env: {
      ...process.env, AUTOMAD_MODE: 'full', AUTOMAD_URL: E2E_URL, AUTOMAD_USER: E2E_USER,
      AUTOMAD_PASS: E2E_PASS, AUTOMAD_THEMES_PATH: THEMES_PATH, AUTOMAD_WRITE_MODE: 'unrestricted',
      AUTOMAD_HTTP_PORT: String(port), AUTOMAD_HTTP_HOST: '127.0.0.1', AUTOMAD_HTTP_TOKEN: token,
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    let buf = '';
    const onData = (c) => {
      buf += c.toString();
      if (buf.includes('listening on http')) {
        child.stderr.removeListener('data', onData);
        child.stderr.on('data', () => {});
        res();
      }
    };
    child.stderr.on('data', onData);
    child.on('exit', (c) => rej(new Error(`server exited ${c}; log: ${buf.slice(0, 400)}`)));
    setTimeout(() => rej(new Error('startup timeout — saw: ' + buf.slice(0, 200))), 15000);
  });
  await new Promise((r) => setTimeout(r, 50));

  let result;
  const t = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { authorization: `Bearer ${token}` } } },
  );
  const c = new Client({ name: 'smoke', version: '0' }, { capabilities: {} });
  try {
    await c.connect(t);
    const r = await c.callTool({ name: tool, arguments: { action, ...args } });
    if (r.isError) {
      const txt = (r.content ?? []).map((c) => c.text ?? '').join('');
      result = { ok: false, error: txt || 'isError=true', content: r.content };
    } else {
      result = { ok: true, content: r.content ?? [] };
    }
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  try { await c.close(); } catch {}
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  USED_PORTS.delete(port);
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000).unref();
  return result;
}

const ACTIONS = [];
for (const cap of CAPABILITY_REGISTRY) {
  for (const [action, meta] of Object.entries(cap.actions)) {
    if (meta.internal) continue;
    ACTIONS.push({ tool: cap.name, action });
  }
}
console.log(`Running ${ACTIONS.length} actions across ${Object.keys(toolSchemas).length} tools.\n`);

// Pre-seed themeSlug with a theme that's installed in every fresh
// container, so theme.activate (which runs before theme.scaffold in
// the registry order) has a real slug to work with.
const state = { themeSlug: 'standard-lite' };
const rows = [];
let i = 0;

for (const { tool, action } of ACTIONS) {
  i++;
  const key = `${tool}.${action}`;
  if (key === 'automad_system.update') {
    process.stdout.write(`[${i.toString().padStart(2, '0')}/${ACTIONS.length}] ${key} … SKIP (would replace running Automad)\n`);
    rows.push({ tool, action, status: 'SKIP', ms: 0, detail: 'would replace running Automad' });
    continue;
  }
  if (key === 'automad_theme.install' || key === 'automad_theme.activate') {
    process.stdout.write(`[${i.toString().padStart(2, '0')}/${ACTIONS.length}] ${key} … SKIP (needs pre-scaffolded theme; covered by tests/e2e)\n`);
    rows.push({ tool, action, status: 'SKIP', ms: 0, detail: 'needs pre-scaffolded theme; covered by tests/e2e' });
    continue;
  }




  let args = buildArgs(tool, action);
  args = { ...args, ...(SEEDS[key] ?? {}) };
  // file_meta.edit_info needs a filename that actually exists in the
  // container. Look one up just-in-time via media.list, overriding
  // the SEED's __lookup__ marker.
  if (key === 'automad_file_meta.edit_info' && args.old_name === '__lookup__') {
    try {
      const probe = await callOnce('automad_media', 'list', { url: '/' });
      const txt = (probe.content ?? []).map((c) => c.text ?? '').join('');
      const m = txt.match(/"basename":\s*"([^"]+\.[a-zA-Z0-9]+)"/);
      if (m) args.old_name = m[1];
    } catch {}
  }

  if (state.themeSlug && 'theme' in args) {
    args.theme = state.themeSlug;
  }
  if (args.url === '__pageUrl__') args.url = state.pageUrl ?? '/';
  if (args.path === '__mediaPath__') args.path = state.mediaPath ?? '/smoke.png';

  // Track the upload filename we just sent so media.delete and
  // file_meta.edit_info can reference it. v2 returns an empty envelope
  // on upload, so we can't read it back — we have to know it.
  if (key === 'automad_media.upload') {
    const sent = SEEDS['automad_media.upload']?.source?.filename;
    if (sent) state.mediaPath = sent;
  }
  if (state.mediaPath && (key === 'automad_media.delete' || key === 'automad_file_meta.edit_info')) {
    const basename = state.mediaPath.split('/').pop();
    if (basename) {
      if ('filename' in args && (args.filename === '__dynamic__' || !args.filename)) {
        args.filename = basename;
      }
      if ('old_name' in args && (args.old_name === '__dynamic__' || !args.old_name)) {
        args.old_name = basename;
      }
    }
  }
  if (!state.mediaPath) {
    if (key === 'automad_media.delete') args.filename = 'favicon.ico';
  }
  if (key === 'automad_theme.activate') {
    args.theme = state.themeSlug ?? args.theme;
  }

  process.stdout.write(`[${i.toString().padStart(2, '0')}/${ACTIONS.length}] ${key} … `);
  const t0 = Date.now();
  let r;
  try {
    r = await callOnce(tool, action, args);
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  const ms = Date.now() - t0;
  let status, detail;
  if (r.ok) {
    status = 'PASS';
    const text = (r.content ?? []).map((c) => c.text ?? '').join('');
    detail = text.length > 0 ? `${text.length}b` : 'ok';
    const provides = PROVIDES[key];
    if (provides) {
      const nameMatch = text.match(/"name":\s*"([^"]+)"/);
      if (nameMatch) {
        state[provides] = nameMatch[1];
      } else {
        const m = text.match(/"(?:url|path|slug)":\s*"([^"]+)"/);
        if (m) state[provides] = m[1];
      }
    }
  } else {
    status = 'FAIL';
    detail = r.error?.slice(0, 200) ?? '?';
  }
  process.stdout.write(`${status} (${ms}ms) ${detail}\n`);
  rows.push({ tool, action, status, ms, detail });

  // After a successful media.delete, the file referenced by
  // state.mediaPath is gone — clear it so a subsequent delete
  // doesn't reference a now-missing file. file_meta.edit_info still
  // needs the path; a previous delete does not invalidate it.
  if (key === 'automad_media.delete' && r.ok) {
    state.mediaPath = null;
  }
}

console.log('\n=== MATRIX ===\n');
const byTool = [...new Set(rows.map((r) => r.tool))];
for (const t of byTool) {
  const sub = rows.filter((r) => r.tool === t);
  const pass = sub.filter((r) => r.status === 'PASS').length;
  console.log(`${t} (${pass}/${sub.length})`);
  for (const r of sub) {
    const ico = r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '~' : '✗';
    console.log(`  ${ico} ${r.action.padEnd(28)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
  }
}
const total = rows.length;
const passed = rows.filter((r) => r.status === 'PASS').length;
const skipped = rows.filter((r) => r.status === 'SKIP').length;
console.log(`\nTotal: ${passed}/${total} pass, ${skipped} skipped`);
process.exit(0);
