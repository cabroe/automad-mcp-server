import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "template-syntax",
  title: "Template syntax",
  tags: ["template", "syntax", "statements", "variables", "blocks", "pipe"],
  reference: "https://automad.org/developer-guide/building-themes/template-language",
  body: `# Template syntax

Automad v2 templates mix three distinct constructs. Getting them right is the
single most common source of theme bugs.

## Statements — \`<@ ... @>\`
PHP-like control structures. Always wrapped in \`<@ ... @>\`.

\`\`\`
<@ components/nav.php @>            <!-- include a component -->
<@ if @{ variable } @> ... <@ end @>
<@ foreach in pagelist @> ... <@ end @>
<@ set { :myVar: "value" } @>
<@ newPagelist { type: 'children' } @>
\`\`\`

## Variables — \`@{ ... }\`
Output a field value. **No** \`<@ @>\` wrapper.

\`\`\`
@{ title }                  <!-- a page/shared field -->
@{ :lang }                  <!-- runtime variable (leading colon) -->
@{ title | def('Untitled') }
@{ text | markdown }
@{ date | dateFormat('d. F Y') }
@{ text | stripTags | shorten(200) }
\`\`\`

## Block editor fields — \`@{ +name }\`
The leading \`+\` marks a block-editor region. No \`<@ @>\`, no spaces after \`+\`.

\`\`\`
@{ +main }
@{ +hero }
\`\`\`

Wrong: \`<@ @{ +main } @>\`, \`@{ + main }\`, \`@{+main}\`.

## Debugging checklist
- Clear the cache after template changes (Dashboard → cache, or delete \`cache/\`).
- \`<@\` not interpreted → enable \`short_open_tag = On\` in php.ini / .user.ini.
- Template not found → the file exists, is referenced in theme.json, and the
  page uses that template.
`,
};
