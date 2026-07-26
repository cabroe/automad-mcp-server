import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "include-path-resolution",
  title: "Include path resolution",
  tags: ["include", "path", "snippet", "resolve", "directory"],
  reference: "https://automad.org/developer-guide/building-themes/template-language/includes",
  body: `# Include path resolution

The single biggest source of "my template renders empty" bugs is misunderstanding
where \`<@ include @>\` looks.

## The rule

The include path is \`<directory of the calling file>/<include path>\`. Always.

\`\`\`
// theme/default.php  (calling file is at theme root)
<@ components/page.php @>     // -> theme/components/page.php  ✓
<@ page.php @>                // -> theme/page.php              ✓
<@ ../shared/foo.php @>       // -> ERROR: .. not allowed       ✗
\`\`\`

## Inside snippets: the path is from the defining file

When an include is inside a \`<@~ snippet name ~@> ... <@~ end ~@>\` body, the path
resolves relative to the directory where the snippet was **defined**, not where
it is invoked. This is the Automad-specific gotcha:

\`\`\`
// theme/default.php
<@ components/page.php @>          // call a component
<@~ snippet main ~@>
    <@ components/home.php @>      // ✓ resolves to theme/components/home.php
                                    //   (the snippet is defined HERE, in default.php)
<@~ end ~@>
\`\`\`

\`\`\`
// theme/components/page.php
<@~ snippet main ~@>                // re-define 'main' here
    <@ home.php @>                  // ✗ ERROR: looking for theme/components/home.php
                                    //   instead of theme/components/home.php — works
                                    //   here only by accident. From a snippet
                                    //   *defined in default.php* this would fail.
<@~ end ~@>
\`\`\`

## Worked example

From the starter kit's canonical layout:

\`\`\`
// theme/default.php
<@ components/page.php @>          // include the shell
<@~ snippet main ~@>
    <@ components/home.php @>      // resolves to theme/components/home.php
<@~ end ~@>
\`\`\`

## Lint rule (when writing the analyzer)

For an \`<@ include @>\` inside a \`<@~ snippet ~@>\` body, resolve the path against
the *defining* file's directory, not the calling template. Two-pass snippet
processing means the defining directory is what matters.

## Practical advice

- Keep snippets near the files that use them, in the same directory.
- If a snippet needs to include something from a sibling directory, use the full
  path from the snippet's defining file.
- The starter kit's \`components/page.php\` includes \`<@ layout.php @>\` from the
  theme root — only works because \`layout.php\` lives there. Move \`page.php\`
  into a subdirectory and the include silently breaks.
`,
};
