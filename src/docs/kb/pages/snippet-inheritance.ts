import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "snippet-inheritance",
  title: "Snippet inheritance (the `main` pattern)",
  tags: ["snippet", "main", "inheritance", "two-pass", "page.php", "layout.php"],
  reference: "https://automad.org/developer-guide/building-themes/template-language/inheritance",
  body: `# Snippet inheritance (the \`main\` pattern)

If a template invokes \`<@ main @>\` but no \`<@~ snippet main ~@>\` is reachable,
the page renders with an empty \`<main>\` — silently, with HTTP 200.

## Canonical pattern

The Automad Theme Starter Kit's layout:

\`\`\`
// theme/default.php
<@ components/page.php @>          // include the document shell
<@~ snippet main ~@>                // define 'main' here (or override)
    <h1>Welcome to the site</h1>
    @{ +main }
<@~ end ~@>
\`\`\`

\`\`\`
// theme/components/page.php  (the document shell)
<!DOCTYPE html>
<html lang="@{ :lang | def('en') }">
  <head>...</head>
  <body>
    <main><@ main @></main>          // ← invokes the snippet
    @{ +footer }
  </body>
</html>
\`\`\`

Page templates (\`pagelist.php\`, \`galerie.php\`) redefine \`main\` to inject
their specific content:

\`\`\`
// theme/pagelist.php
<@~ snippet main ~@>
    <h1>All pages</h1>
    <@ newPagelist { type: 'children' } @>
<@~ end ~@>
\`\`\`

## Two-pass processing

The template engine runs in **two passes**:

1. **First pass**: collect all \`<@~ snippet name ~@> ... <@~ end ~@>\` definitions
   into a registry. No output is produced.
2. **Second pass**: render the template, looking up snippets from the registry
   when \`<@ snippetName @>\` or \`<@ path/to/file @>\` (which expands to a
   \`<@~ snippet main ~@>\` lookup) is encountered.

**This means:** the order of \`<@~ snippet ~@>\` vs \`<@ include @>\` in your
template does not matter for correctness — both passes run over the whole
template file regardless of position.

## Common bug: custom theme puts HTML directly in page.php

A theme that doesn't use the starter kit's indirection and puts the full HTML
in \`page.php\` directly has no \`main\` snippet registered. If any layout file
or shared component invokes \`<@ main @>\`, that section is empty. Either:

- Register \`main\` explicitly somewhere reachable, OR
- Remove all \`<@ main @>\` invocations and inline the content.

## Lint check

\`automad_theme.analyze\` walks the call graph from \`default.php\` (and any
other root templates) and reports any \`<@ main @>\` invocation that has no
reachable \`<@~ snippet main ~@>\` definition.
`,
};
