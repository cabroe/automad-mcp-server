import * as path from "node:path";
import { AutomadMcpError } from "../errors.js";
import { type ThemeFs, assertWithinRoot } from "./fs.js";

export interface FileEntry {
  /** Path relative to the theme root, using forward slashes. */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  size: number;
}

export interface EditorDeps {
  fs: ThemeFs;
  themesPath: string;
}

const ALLOWED_EXTENSIONS: string[] = [
  ".php", ".json", ".ts", ".js", ".mjs", ".cjs",
  ".css", ".less", ".scss",
  ".html", ".htm", ".svg", ".md", ".txt",
  ".yml", ".yaml", ".env", ".sh",
];

/** Resolve a `theme/rel/path` to an absolute path inside the theme, with guards. */
export function resolveInTheme(theme: string, relPath: string, themesPath: string): { abs: string; rel: string } {
  if (relPath.includes("..")) {
    throw new AutomadMcpError("VALIDATION", `relative path '${relPath}' must not contain '..'`);
  }
  const cleanRel = relPath.replace(/^\/+/, "");
  const themesRoot = path.resolve(themesPath);
  const themeRoot = assertWithinRoot(themesRoot, path.resolve(themesRoot, theme));
  const target = assertWithinRoot(themeRoot, path.resolve(themeRoot, cleanRel));
  return { abs: target, rel: path.relative(themeRoot, target) };
}

export interface ListFilesOptions {
  path?: string | undefined;
  extensions?: string[] | undefined;
}

/** List files inside a theme. Optionally restrict to a subdirectory. */
export async function listFiles(
  theme: string,
  deps: EditorDeps,
  opts: ListFilesOptions = {},
): Promise<FileEntry[]> {
  const { fs, themesPath } = deps;
  const baseAbs = opts.path
    ? resolveInTheme(theme, opts.path, themesPath).abs
    : path.resolve(themesPath, theme);
  if (!(await fs.exists(baseAbs))) {
    throw new AutomadMcpError("NOT_FOUND", `path not found: ${opts.path ?? "/"}`);
  }
  const exts = opts.extensions ?? ALLOWED_EXTENSIONS;
  const absFiles = await fs.list(baseAbs, { recursive: true, extensions: exts });
  const themeRoot = path.resolve(themesPath, theme);
  const entries: FileEntry[] = [];
  for (const abs of absFiles) {
    try {
      const content = await fs.readFile(abs);
      entries.push({
        absPath: abs,
        relPath: path.relative(themeRoot, abs).split(path.sep).join("/"),
        size: content.length,
      });
    } catch {
      // skip unreadable
    }
  }
  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Read a theme file as text. */
export async function readFile(
  theme: string,
  relPath: string,
  deps: EditorDeps,
): Promise<{ relPath: string; content: string; size: number }> {
  const { fs, themesPath } = deps;
  const { abs, rel } = resolveInTheme(theme, relPath, themesPath);
  if (!(await fs.exists(abs))) {
    throw new AutomadMcpError("NOT_FOUND", `file not found: ${relPath}`);
  }
  const content = await fs.readFile(abs);
  return { relPath: rel, content, size: content.length };
}

/** Write a theme file as text. Overwrites existing files. */
export async function writeFile(
  theme: string,
  relPath: string,
  content: string,
  deps: EditorDeps,
): Promise<{ relPath: string; size: number }> {
  const { fs, themesPath } = deps;
  const { abs, rel } = resolveInTheme(theme, relPath, themesPath);
  await fs.writeFile(abs, content);
  return { relPath: rel, size: content.length };
}
