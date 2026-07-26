import type { DocPage } from '../../kb.js';

export const page: DocPage = {
  slug: 'runtime-lang',
  title: 'Runtime :lang vs per-page textLanguage',
  tags: ['lang', 'i18n', 'textLanguage', 'AM_I18N_ENABLED'],
  reference:
    'https://automad.org/developer-guide/building-themes/template-language/multilingual-content',
  body: `# Runtime \`:lang\` vs per-page \`textLanguage\`

A common confusion: setting \`textLanguage\` on a page does NOT change
\`@{ :lang }\` in the template.

## What \`:lang\` is

\`:lang\` is a **system runtime variable** (note the leading colon). Automad
sets it from the URL prefix (\`/de/\`, \`/en/\`) when:

1. \`AM_I18N_ENABLED = true\` is set in \`config/config.php\`
2. The page lives under \`pages/de/\` or \`pages/en/\` (or another configured
   language tree)

## What \`textLanguage\` is

\`textLanguage\` is a **page data field** — just a regular page variable you can
read via \`@{ textLanguage }\`. It's not connected to \`:lang\` at all. It's
useful for content-level language hints (e.g. "this page's body is in English
even on the German site"), but the runtime language is still \`:lang\`.

## Per-page language override

To override the runtime \`:lang\` for a specific page, do it in the calling
template:

\`\`\`
<@ set { :lang: @{ textLanguage | def(@{ :lang }) } } @>
\`\`\`

Or via a custom function (see \`custom-functions\`):

\`\`\`
<@ t { key: 'welcome', lang: @{ :lang } } @>
\`\`\`

## Multilingual recipe

1. Create \`pages/de/\` and \`pages/en/\` directory trees under \`pages/\`
2. In \`config/config.php\`: \`define('AM_I18N_ENABLED', true);\`
3. In your theme, create \`i18n/strings.php\` returning
   \`['de' => ['key' => 'Wert'], 'en' => ['key' => 'Value']]\`
4. Register a \`t\` helper via \`CustomFunction::add\` (see \`custom-functions\`)
5. Call \`<@ t { key: 'welcome' } @>\` from templates

## Analyzer warning

\`automad_theme.validate\` reports \`LANG_WITHOUT_I18N\` when a template uses
\`@{ :lang }\` and the theme ships no parsable \`i18n/*.json\` translations.
A reference carrying an explicit fallback — \`@{ :lang | def('en') }\` — is
treated as a deliberate single-language choice and does not warn.
`,
};
