import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP prompts for common Automad workflows. Each prompt renders a single user
 * message that steers the model through the real tool actions (pages/theme/
 * docs). Prompt arguments are strings (per the MCP prompt contract).
 */

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "create_blog_post",
    {
      title: "Create a blog post",
      description: "Draft, fill, and publish a new Automad page under a parent.",
      argsSchema: {
        title: z.string().describe("Page title"),
        parent: z.string().optional().describe("Parent page URL (default '/')"),
        summary: z.string().optional().describe("Short teaser / summary text"),
      },
    },
    ({ title, parent, summary }) =>
      userMessage(
        [
          `Create a new Automad page titled "${title}" under parent "${parent ?? "/"}".`,
          "",
          "Steps (use the `automad_pages` tool):",
          `1. Call action \`create\` with \`title: "${title}"\` and \`target_url: "${parent ?? "/"}"\`.`,
          summary ? `2. Call action \`update\` on the new page URL, setting \`fields.text\` to a body that opens with: "${summary}".` : "2. Call action `update` on the new page URL to add the body via `fields`.",
          "3. Confirm the page is live by calling action `get` on the returned URL.",
          "",
          "Tip: pass `publish: false` on create/update to keep it as a draft, then call action `publish` when ready.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "scaffold_theme",
    {
      title: "Scaffold and build a theme",
      description: "Create a theme from the starter kit, add a nav snippet, build it.",
      argsSchema: {
        name: z.string().describe("Theme display name"),
        author: z.string().optional().describe("Theme author"),
      },
    },
    ({ name, author }) =>
      userMessage(
        [
          `Scaffold a new Automad theme named "${name}"${author ? ` by ${author}` : ""} and get it building.`,
          "",
          "Steps (use the `automad_theme` tool):",
          `1. \`scaffold\` with \`name: "${name}"\`${author ? ` and \`author: "${author}"\`` : ""} (destructive — replay with the returned confirm_token).`,
          "2. `generate` a `nav` snippet, review the content, then `diff` it against the target path before `write`.",
          "3. `write` the reviewed snippet into the theme.",
          "4. `build` the theme (runs composer install if composer.json exists, then npm install + build).",
          "5. `activate` the theme (best-effort; if v2 declines, activate it from the dashboard).",
          "",
          "Before every `write`, preview with `diff` so the change is visible first.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "analyze_theme",
    {
      title: "Analyze a theme and suggest improvements",
      description: "Inspect a local theme and produce concrete, prioritized fixes.",
      argsSchema: {
        theme: z.string().describe("Theme slug under AUTOMAD_THEMES_PATH"),
      },
    },
    ({ theme }) =>
      userMessage(
        [
          `Analyze the Automad theme "${theme}" and propose improvements.`,
          "",
          "Steps:",
          `1. \`automad_theme\` action \`analyze\` on "${theme}" — inventory templates, blocks, fields, i18n, masks, build files.`,
          `2. \`automad_theme\` action \`validate\` on "${theme}" — collect findings and severity counts.`,
          `3. \`automad_theme\` action \`schema\` on "${theme}" — see the normalized field schema and locales.`,
          "4. Cross-check field references against theme.json masks/fieldOrder; consult `automad_docs` (`theme-json`, `blocks`, `i18n`) for correct patterns.",
          "",
          "Deliver: a prioritized list of concrete fixes (errors first, then warnings, then polish), each with the file/field and the exact change.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "check_headless_setup",
    {
      title: "Check headless / API setup",
      description: "Verify the live instance is reachable and review headless usage.",
      argsSchema: {},
    },
    () =>
      userMessage(
        [
          "Check whether this Automad instance is ready for headless/API use.",
          "",
          "Steps:",
          "1. `automad_site` action `health` — confirm reachable + authenticated, note version and latency.",
          "2. `automad_config` action `get` — review envKeys and relevant flags.",
          "3. Read the `automad://docs/headless` resource (or `automad_docs` get `headless`) for the /_api endpoint contract and CSRF/session model.",
          "",
          "Report: is the instance healthy, which endpoints are available, and any gap (e.g. the known `/_api/public/pagelist` 500) the client should route around.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "find_docs",
    {
      title: "Find Automad docs",
      description: "Search the offline knowledge base and return the best page.",
      argsSchema: {
        topic: z.string().describe("What to look up (e.g. 'foreach', 'i18n', 'theme.json')"),
      },
    },
    ({ topic }) =>
      userMessage(
        [
          `Look up "${topic}" in the Automad knowledge base.`,
          "",
          "Steps (use the `automad_docs` tool):",
          `1. \`search\` with \`query: "${topic}"\`.`,
          "2. `get` the top-ranked slug and summarize the answer with a short code example.",
          "3. If nothing matches, `list` the available pages and pick the closest.",
        ].join("\n"),
      ),
  );
}
