import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { ThemeInput } from "../schemas.js";
import { LocalThemeFs, type ThemeFs } from "../theme/fs.js";
import { ThemeManager } from "../theme/manager.js";
import { scaffold, type ScaffoldDeps } from "../theme/scaffold.js";
import { listFiles, readFile, writeFile, type EditorDeps } from "../theme/editor.js";
import { ThemeAnalyzer } from "../theme/analyzer.js";

type ThemeAction = ThemeInput["action"];

const ACTION_MAP: Record<ThemeAction, WriteAction> = {
  list: "theme.list",
  install: "theme.install",
  activate: "theme.activate",
  uninstall: "theme.uninstall",
  scaffold: "theme.scaffold",
  build: "theme.build",
  read: "theme.read",
  write: "theme.write",
  files: "theme.list",
  analyze: "theme.analyze",
  validate: "theme.validate",
};

export interface ThemeHandlerDeps {
  client: HttpClient;
  guard: WriteGuard;
  themesPath: string;
  starterKitPath: string;
  /** Override for tests. Defaults to LocalThemeFs. */
  fs?: ThemeFs;
}

export async function handleTheme(
  input: ThemeInput,
  deps: ThemeHandlerDeps,
): Promise<unknown> {
  const permit = deps.guard.check(ACTION_MAP[input.action], input.theme ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  const fs: ThemeFs = deps.fs ?? new LocalThemeFs();
  const editor: EditorDeps = { fs, themesPath: deps.themesPath };
  const scaffoldDeps: ScaffoldDeps = { fs, themesPath: deps.themesPath, starterKitPath: deps.starterKitPath };
  const manager = new ThemeManager({
    fs,
    themesPath: deps.themesPath,
    starterKitPath: deps.starterKitPath,
    client: deps.client,
  });
  const analyzer = new ThemeAnalyzer({ fs, themesPath: deps.themesPath });

  switch (input.action) {
    case "analyze": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for analyze");
      return analyzer.analyze(input.theme);
    }
    case "validate": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for validate");
      return analyzer.validate(input.theme);
    }
    case "list":
      return manager.list();
    case "install": {
      if (!input.source) throw new AutomadMcpError("VALIDATION", "source is required for install");
      return manager.install(input.source, input.theme);
    }
    case "activate": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for activate");
      return manager.activate(input.theme);
    }
    case "uninstall": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for uninstall");
      return manager.uninstall(input.theme);
    }
    case "scaffold": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required for scaffold");
      return scaffold(
        {
          name: input.name,
          description: input.description,
          author: input.author,
          license: input.license,
          version: input.version,
        },
        scaffoldDeps,
      );
    }
    case "build": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for build");
      return manager.build(input.theme, { install: input.install });
    }
    case "files": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for files");
      return listFiles(input.theme, editor, { path: input.path });
    }
    case "read": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for read");
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required for read");
      return readFile(input.theme, input.path, editor);
    }
    case "write": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for write");
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required for write");
      if (input.content === undefined) throw new AutomadMcpError("VALIDATION", "content is required for write");
      return writeFile(input.theme, input.path, input.content, editor);
    }
  }
}
