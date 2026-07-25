import type { z } from "zod";
import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { Config } from "../config.js";
import type { WriteGuard } from "../write-guard.js";
import {
  getCapability,
  TOOL_NAMES,
  type ToolName,
  type ToolRequirement,
} from "./registry.js";
import {
  TOOL_INPUT_SCHEMAS,
  pagesInput,
  mediaInput,
  sharedInput,
  configInput,
  siteInput,
  themeInput,
  docsInput,
  discoverInput,
} from "../schemas.js";
import { handlePages } from "../domains/pages.js";
import { handleMedia } from "../domains/media.js";
import { handleShared } from "../domains/shared.js";
import { handleConfig } from "../domains/config.js";
import { handleSite } from "../domains/site.js";
import { handleTheme, type ThemeHandlerDeps } from "../domains/theme.js";
import { handleDocs } from "../domains/docs.js";
import { handleDiscover } from "../domains/discover.js";

/**
 * Wiring layer on top of the capability registry: one binding per tool,
 * carrying its input schema and its dispatch into a domain router. `server.ts`
 * registers whatever is in `TOOL_BINDINGS` — it holds no per-tool knowledge of
 * its own, so adding a tool means adding a registry entry plus a binding here.
 *
 * Titles, descriptions and the runtime gate (`requires`) come from the
 * registry, never from this file.
 */

export interface ToolContext {
  readonly client: HttpClient;
  readonly guard: WriteGuard;
  readonly config: Config;
  /** Present only when `AUTOMAD_THEMES_PATH` is configured. */
  readonly themeDeps?: ThemeHandlerDeps | undefined;
}

export interface ToolBinding {
  readonly name: ToolName;
  readonly inputSchema: z.ZodTypeAny;
  /** Runs the registry gate, then the domain router. Input is validated on the way in. */
  readonly run: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

export const LIVE_DISABLED_MESSAGE =
  "Live API tools are disabled (AUTOMAD_MODE=docs or missing credentials). " +
  "Set AUTOMAD_MODE=full with AUTOMAD_URL/AUTOMAD_USER/AUTOMAD_PASS to enable them.";

export const THEMES_DISABLED_MESSAGE =
  "automad_theme is disabled: set AUTOMAD_THEMES_PATH (and optionally AUTOMAD_STARTER_KIT_PATH) to enable it.";

function assertLiveEnabled(ctx: ToolContext): void {
  if (!ctx.config.liveEnabled) throw new AutomadMcpError("UNSUPPORTED", LIVE_DISABLED_MESSAGE);
}

/** Doubles as the `themes` gate and as the type narrowing the theme router needs. */
function requireThemeDeps(ctx: ToolContext): ThemeHandlerDeps {
  if (!ctx.themeDeps) throw new AutomadMcpError("UNSUPPORTED", THEMES_DISABLED_MESSAGE);
  return ctx.themeDeps;
}

const GATES: Record<ToolRequirement, (ctx: ToolContext) => void> = {
  none: () => undefined,
  live: assertLiveEnabled,
  themes: (ctx) => {
    requireThemeDeps(ctx);
  },
};

function bind<S extends z.ZodTypeAny>(
  name: ToolName,
  inputSchema: S,
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>,
): ToolBinding {
  const gate = GATES[getCapability(name).requires];
  return {
    name,
    inputSchema,
    // `async` so a gate rejection or a schema error surfaces as a rejected
    // promise, never as a synchronous throw at the call site.
    run: async (input, ctx) => {
      gate(ctx);
      // The MCP SDK already validated `input` against this very schema; parsing
      // again is how the erased binding recovers the typed shape without a cast
      // (and keeps direct callers, e.g. tests, on the same contract).
      return run(inputSchema.parse(input), ctx);
    },
  };
}

export const TOOL_BINDINGS: Readonly<Record<ToolName, ToolBinding>> = {
  automad_pages: bind("automad_pages", pagesInput, (input, ctx) => handlePages(input, ctx.client, ctx.guard)),
  automad_media: bind("automad_media", mediaInput, (input, ctx) => handleMedia(input, ctx.client, ctx.guard)),
  automad_shared: bind("automad_shared", sharedInput, (input, ctx) => handleShared(input, ctx.client, ctx.guard)),
  automad_config: bind("automad_config", configInput, (input, ctx) => handleConfig(input, ctx.client, ctx.guard)),
  automad_site: bind("automad_site", siteInput, (input, ctx) => handleSite(input, ctx.client, ctx.guard)),
  automad_docs: bind("automad_docs", docsInput, (input, ctx) => handleDocs(input, ctx.guard)),
  // The `themes` gate already ran; calling it again is how the router gets a
  // non-optional `ThemeHandlerDeps` out of the context.
  automad_theme: bind("automad_theme", themeInput, (input, ctx) => handleTheme(input, requireThemeDeps(ctx))),
  automad_discover: bind("automad_discover", discoverInput, (input, ctx) => handleDiscover(input, ctx.guard)),
};

/** Bindings in registry order — the order tools are registered and listed in. */
export function listToolBindings(): readonly ToolBinding[] {
  return TOOL_NAMES.map((name) => TOOL_BINDINGS[name]);
}

/**
 * Boot-time check that the wiring layer still matches the registry: every tool
 * has a binding under its own name, using the schema registered for it.
 */
export function validateToolBindings(): void {
  for (const name of TOOL_NAMES) {
    const binding = TOOL_BINDINGS[name];
    if (binding.name !== name) throw new Error(`Tool binding registered under the wrong name: ${name} → ${binding.name}`);
    if (binding.inputSchema !== TOOL_INPUT_SCHEMAS[name]) {
      throw new Error(`Tool binding ${name} does not use its registered input schema`);
    }
  }
}
