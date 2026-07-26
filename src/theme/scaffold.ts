import * as path from 'node:path';
import { AutomadMcpError } from '../errors.js';
import { type ThemeFs, assertWithinRoot } from './fs.js';
import { assertStarterKitLayout } from './dev.js';
import { assertSafeThemeSlug } from './slug.js';
import type { ThemeManifest } from './manager.js';

export interface ScaffoldOptions {
  /** Human-readable theme name (becomes `name` in theme.json and `package.json`). */
  name: string;
  /** Optional theme description. */
  description?: string | undefined;
  /** Optional author. */
  author?: string | undefined;
  /** Optional license. Defaults to "MIT". */
  license?: string | undefined;
  /** Optional version. Defaults to "0.1.0". */
  version?: string | undefined;
}

export interface ScaffoldResult {
  path: string;
  name: string;
  files: number;
  manifest: ThemeManifest;
}

export interface ScaffoldDeps {
  fs: ThemeFs;
  starterKitPath: string;
  themesPath: string;
}

/** Slugify a theme name into a directory name. */
export function themeSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'new-theme'
  );
}

/**
 * Scaffold a new theme by copying the starter-kit template into
 * `themesPath/<slug>` and rewriting `theme.json` + `package.json` with the
 * caller's metadata.
 */
export async function scaffold(opts: ScaffoldOptions, deps: ScaffoldDeps): Promise<ScaffoldResult> {
  const { fs, starterKitPath, themesPath } = deps;

  if (!(await fs.exists(starterKitPath))) {
    throw new AutomadMcpError(
      'NOT_FOUND',
      `starter kit not found at ${starterKitPath}. Set AUTOMAD_STARTER_KIT_PATH or place the starter kit at AUTOMAD_THEMES_PATH.`,
    );
  }
  const manifestPath = path.join(starterKitPath, 'theme.json');
  if (!(await fs.exists(manifestPath))) {
    throw new AutomadMcpError(
      'VALIDATION',
      `starter kit at ${starterKitPath} is missing theme.json — not a valid theme template`,
    );
  }

  const slug = themeSlug(opts.name);
  assertSafeThemeSlug(slug);
  const target = assertWithinRoot(themesPath, path.join(themesPath, slug));
  if (await fs.exists(target)) {
    throw new AutomadMcpError('CONFLICT', `theme '${slug}' already exists at ${target}`);
  }
  await assertStarterKitLayout(starterKitPath, fs);
  await fs.mkdirp(target);
  await fs.copyDir(starterKitPath, target);

  const tmplManifest = JSON.parse(await fs.readFile(manifestPath)) as ThemeManifest;
  const manifest: ThemeManifest = {
    ...tmplManifest,
    name: opts.name,
    description: opts.description ?? tmplManifest.description ?? '',
    author: opts.author ?? tmplManifest.author ?? '',
    license: opts.license ?? tmplManifest.license ?? 'MIT',
    version: opts.version ?? tmplManifest.version ?? '0.1.0',
  };
  await fs.writeFile(path.join(target, 'theme.json'), JSON.stringify(manifest, null, 2) + '\n');

  const pkgPath = path.join(target, 'package.json');
  if (await fs.exists(pkgPath)) {
    const pkg = JSON.parse(await fs.readFile(pkgPath)) as Record<string, unknown>;
    pkg['name'] = slug;
    pkg['description'] = opts.description ?? pkg['description'] ?? '';
    if (opts.author) pkg['author'] = opts.author;
    if (opts.license) pkg['license'] = opts.license;
    if (opts.version) pkg['version'] = opts.version;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  const files = await fs.list(target, { recursive: true });
  return { path: target, name: opts.name, files: files.length, manifest };
}
