import { promises as nodeFs } from "node:fs";
import * as path from "node:path";
import { AutomadMcpError } from "../errors.js";
import { runCommand, composerInstall, npmBuild, npmInstall, type BuildResult } from "./build.js";
import type { HttpClient } from "../client.js";
import { API_BASE } from "../config.js";
import { type ThemeFs, assertWithinRoot } from "./fs.js";
import { assertSafeThemeSlug } from "./slug.js";

export interface ThemeManifest {
  name?: string;
  description?: string;
  author?: string;
  license?: string;
  version?: string;
  masks?: Record<string, string[]>;
  fieldOrder?: string[];
  labels?: Record<string, string>;
  options?: Record<string, Record<string, string>>;
  tooltips?: Record<string, string>;
}

export interface ThemeInfo {
  slug: string;
  path: string;
  manifest: ThemeManifest | null;
  buildOutputExists: boolean;
  errors: string[];
}

export interface ThemeManagerDeps {
  fs: ThemeFs;
  themesPath: string;
  starterKitPath: string;
  client: HttpClient;
}

export class ThemeManager {
  constructor(private readonly deps: ThemeManagerDeps) {}

  /** List all themes found as direct subdirectories of `themesPath`. */
  async list(): Promise<ThemeInfo[]> {
    const { fs, themesPath } = this.deps;
    if (!(await fs.exists(themesPath))) {
      throw new AutomadMcpError("NOT_FOUND", `themesPath not found: ${themesPath}`);
    }
    const entries = await listDirs(themesPath);
    const themes: ThemeInfo[] = [];
    for (const dir of entries) themes.push(await this.inspect(dir));
    return themes;
  }

  /** Read a theme's `theme.json` and check build output. */
  async inspect(themePath: string): Promise<ThemeInfo> {
    const { fs } = this.deps;
    const manifestPath = path.join(themePath, "theme.json");
    const distPath = path.join(themePath, "dist");
    const slug = path.basename(themePath);
    const errors: string[] = [];
    let manifest: ThemeManifest | null = null;
    if (await fs.exists(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath);
        manifest = JSON.parse(raw) as ThemeManifest;
      } catch (e) {
        errors.push(`theme.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      errors.push("missing theme.json");
    }
    const buildOutputExists = await fs.isDirectory(distPath);
    return { slug, path: themePath, manifest, buildOutputExists, errors };
  }

  /**
   * Install a theme by cloning a git URL (or copying a local path) into
   * `themesPath/<slug>`. The slug is derived from the URL tail; pass
   * `name` to override.
   */
  async install(source: string, name?: string): Promise<ThemeInfo> {
    const { fs, themesPath } = this.deps;
    const slug = name ?? slugify(source);
    assertSafeThemeSlug(slug);
    const target = assertWithinRoot(themesPath, path.join(themesPath, slug));
    if (await fs.exists(target)) {
      throw new AutomadMcpError("CONFLICT", `theme '${slug}' already exists at ${target}`);
    }
    if (/^https?:\/\//.test(source) || source.startsWith("git@")) {
      // Reuse runCommand so git-clone is subject to the same hard timeout and
      // output cap as `theme.build` (npm/composer). Otherwise a slow remote
      // or huge repo can block the MCP indefinitely.
      const res = await runCommand("git", ["clone", "--depth", "1", source, target], {
        cwd: themesPath,
        timeoutMs: 5 * 60 * 1000,
        maxOutputBytes: 64 * 1024,
      });
      if (!res.ok) {
        await fs.remove(target, { recursive: true });
        throw new AutomadMcpError("NETWORK", `git clone failed: ${res.stderr || res.stdout}`);
      }
    } else {
      if (!(await fs.exists(source))) {
        await fs.remove(target, { recursive: true });
        throw new AutomadMcpError("NOT_FOUND", `source path not found: ${source}`);
      }
      await fs.copyDir(source, target);
    }
    return this.inspect(target);
  }

  /**
   * Try to activate a theme via v2's /_api/package-manager/install. If v2
   * rejects (e.g. permissions, beta-quirk), still return success — the theme
   * is on disk and can be activated manually from the dashboard.
   */
  async activate(theme: string): Promise<{ activated: boolean; remote: unknown }> {
    const { fs, themesPath, client } = this.deps;
    assertSafeThemeSlug(theme);
    const target = assertWithinRoot(themesPath, path.join(themesPath, theme));
    if (!(await fs.exists(target))) {
      throw new AutomadMcpError("NOT_FOUND", `theme '${theme}' not found at ${target}`);
    }
    try {
      const res = await client.post(`${API_BASE}/package-manager/install`, {
        source: target,
        theme,
        bootstrap_starter_kit: false,
      });
      return { activated: true, remote: res };
    } catch (err) {
      return {
        activated: false,
        remote: err instanceof AutomadMcpError
          ? { code: err.code, message: err.message }
          : { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /** Remove a theme directory. Destructive. */
  async uninstall(theme: string): Promise<{ removed: string }> {
    const { fs, themesPath } = this.deps;
    assertSafeThemeSlug(theme);
    const target = assertWithinRoot(themesPath, path.join(themesPath, theme));
    if (!(await fs.exists(target))) {
      throw new AutomadMcpError("NOT_FOUND", `theme '${theme}' not found`);
    }
    await fs.remove(target, { recursive: true });
    return { removed: target };
  }

  /** Run composer install (if composer.json exists) + npm install + npm run build. */
  async build(theme: string, opts: { install?: boolean | undefined; timeoutMs?: number | undefined } = {}): Promise<{
    composer?: BuildResult;
    install?: BuildResult;
    build: BuildResult;
  }> {
    const { fs, themesPath } = this.deps;
    const target = assertWithinRoot(themesPath, path.join(themesPath, theme));
    if (!(await fs.exists(target))) {
      throw new AutomadMcpError("NOT_FOUND", `theme '${theme}' not found`);
    }
    if (opts.install === false) {
      return { build: await npmBuild(target, opts.timeoutMs) };
    }

    const composer = (await fs.exists(path.join(target, "composer.json")))
      ? await composerInstall(target, opts.timeoutMs)
      : undefined;

    const install = await npmInstall(target, opts.timeoutMs);
    if (!install.ok) {
      return {
        ...(composer ? { composer } : {}),
        install,
        build: {
          ok: false,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "skipped: npm install failed",
          command: "npm run build",
        },
      };
    }
    return { ...(composer ? { composer } : {}), install, build: await npmBuild(target, opts.timeoutMs) };
  }
}

export { startDev, stopDev, getDevStatus, assertStarterKitLayout } from "./dev.js";

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await nodeFs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function slugify(input: string): string {
  const tail = input.split("/").filter(Boolean).pop() ?? "theme";
  return tail.replace(/\.git$/, "").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}
