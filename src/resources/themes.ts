import * as path from 'node:path';
import { AutomadMcpError } from '../errors.js';
import { LocalThemeFs, type ThemeFs } from '../theme/fs.js';
import { ThemeAnalyzer } from '../theme/analyzer.js';
import { ThemeSchemaBuilder } from '../theme/schema.js';

const SLUG_RE = /^[a-z0-9._-]+$/;

export interface ThemeListEntry {
  slug: string;
  name: string;
  path: string;
  manifest: { name: string; version: string; author: string };
}

export interface ThemesList {
  themesPath: string | null;
  themes: ThemeListEntry[];
}
export interface ThemeResourceDeps {
  themesPath?: string | undefined;
  fs?: ThemeFs;
}
export function readThemesList(deps: ThemeResourceDeps): Promise<ThemesList> {
  if (!deps.themesPath) return Promise.resolve({ themesPath: null, themes: [] });
  const fs: ThemeFs = deps.fs ?? new LocalThemeFs();
  return listThemes(deps.themesPath, fs).then((themes) => ({
    themesPath: deps.themesPath ?? null,
    themes,
  }));
}

async function listThemes(themesPath: string, fs: ThemeFs): Promise<ThemeListEntry[]> {
  if (!(await fs.exists(themesPath))) return [];
  const names = new Set<string>();
  for (const file of await fs.list(themesPath, { recursive: true })) {
    const rel = path.relative(themesPath, file).split(/[/\\]/).filter(Boolean);
    if (rel.length === 2 && rel[1] === 'theme.json' && SLUG_RE.test(rel[0]!)) {
      names.add(rel[0]!);
    }
  }
  const slugs = [...names].sort();
  const out: ThemeListEntry[] = [];
  for (const slug of slugs) {
    const manifest = await readManifest(fs, themesPath, slug);
    out.push({ slug, name: manifest.name, path: path.join(themesPath, slug), manifest });
  }
  return out;
}

async function readManifest(fs: ThemeFs, themesPath: string, slug: string) {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(themesPath, slug, 'theme.json')));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const m = raw as Record<string, unknown>;
      return {
        name: typeof m.name === 'string' ? m.name : slug,
        version: typeof m.version === 'string' ? m.version : '',
        author: typeof m.author === 'string' ? m.author : '',
      };
    }
  } catch {
    /* ignore */
  }
  return { name: slug, version: '', author: '' };
}

export async function readThemeSchema(deps: ThemeResourceDeps, slug: string): Promise<unknown> {
  if (!deps.themesPath) throw new AutomadMcpError('NOT_FOUND', 'themesPath not configured');
  if (!SLUG_RE.test(slug) || slug.includes('..') || path.isAbsolute(slug)) {
    throw new AutomadMcpError('NOT_FOUND', `unknown theme '${slug}'`);
  }
  const fs: ThemeFs = deps.fs ?? new LocalThemeFs();
  const analyzer = new ThemeAnalyzer({ fs, themesPath: deps.themesPath });
  const builder = new ThemeSchemaBuilder();
  const analysis = await analyzer.analyze(slug);
  return builder.build(analysis);
}
