/**
 * Theme filesystem abstraction.
 *
 * Hides the local-vs-remote split (local fs now, SSH later) behind a small
 * interface. All theme tooling consumes `ThemeFs` rather than touching
 * `node:fs` directly.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AutomadMcpError } from "../errors.js";

export interface ThemeFs {
  exists(p: string): Promise<boolean>;
  isDirectory(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  list(p: string, opts?: { recursive?: boolean; extensions?: string[] }): Promise<string[]>;
  mkdirp(p: string): Promise<void>;
  remove(p: string, opts?: { recursive?: boolean }): Promise<void>;
  copyDir(src: string, dest: string): Promise<void>;
}

/** Local-filesystem implementation of ThemeFs. */
export class LocalThemeFs implements ThemeFs {
  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(p: string): Promise<boolean> {
    try {
      const st = await fs.stat(p);
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  async readFile(p: string): Promise<string> {
    return fs.readFile(p, "utf8");
  }

  async writeFile(p: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf8");
  }

  async list(p: string, opts: { recursive?: boolean; extensions?: string[] } = {}): Promise<string[]> {
    const found: string[] = [];
    const exts = opts.extensions;
    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (opts.recursive) await walk(full);
        } else if (ent.isFile()) {
          if (!exts || exts.some((e) => ent.name.endsWith(e))) {
            found.push(full);
          }
        }
      }
    }
    await walk(p);
    return found.sort();
  }

  async mkdirp(p: string): Promise<void> {
    await fs.mkdir(p, { recursive: true });
  }

  async remove(p: string, opts: { recursive?: boolean } = {}): Promise<void> {
    if (opts.recursive) {
      await fs.rm(p, { recursive: true, force: true });
    } else {
      await fs.unlink(p);
    }
  }

  async copyDir(src: string, dest: string): Promise<void> {
    await fs.cp(src, dest, { recursive: true });
  }
}

/** Path-traversal guard: refuse to operate on paths that escape `root`. */
export function assertWithinRoot(root: string, target: string): string {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  if (absTarget !== absRoot && !absTarget.startsWith(absRoot + path.sep)) {
    throw new AutomadMcpError(
      "VALIDATION",
      `Path '${target}' escapes allowed root '${root}'`,
    );
  }
  return absTarget;
}
