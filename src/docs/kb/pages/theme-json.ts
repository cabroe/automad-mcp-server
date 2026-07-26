import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "theme-json",
  title: "theme.json",
  tags: ["theme.json", "manifest", "masks", "fieldorder", "tooltips", "options"],
  reference: "https://automad.org/developer-guide/building-themes/theme-json",
  body: `
The manifest that describes a theme to the dashboard.

\`\`\`json
{
  "name": "My Theme",
  "version": "1.0.0",
  "author": "Jane Doe",
  "license": "MIT",
  "description": "A clean blog theme",
  "masks": { "page": ["+main"], "shared": ["sitename", "+footer"] },
  "fieldOrder": ["title", "+main"],
  "labels": { "title": "Page title" },
  "tooltips": { "+main": "Main content area" },
  "options": {
    "selectTheme": { "light": "Light", "dark": "Dark" }
  }
}
\`\`\`

| Key | Purpose |
|---|---|
| \`masks\` | which fields appear in the page vs. shared data editor |
| \`fieldOrder\` | order of fields in the dashboard |
| \`labels\` | human-readable field labels |
| \`tooltips\` | help text per field |
| \`options\` | select/choice widgets: field → {value: label} |

Field names referenced in templates via \`@{ field }\` should be surfaced through
\`masks\`/\`fieldOrder\` so editors can fill them. Run \`automad_theme.schema\` to get
a normalized view of every field a theme uses.`,
};
