import type { DocPage } from '../../kb.js';

export const page: DocPage = {
  slug: 'custom-functions',
  title: 'Custom functions (CustomFunction registry)',
  tags: ['function', 'CustomFunction', 'registry', 't', 'i18n'],
  reference: 'https://automad.org/developer-guide/developing-extensions',
  body: `# Custom functions

The Automad template engine looks up \`<@ myFn { ... } @>\` via a **registry**, not
the global PHP function table. Plain PHP \`function myFn() {}\` in
\`lib/functions.php\` is **invisible** to templates.

## Registration pattern

\`\`\`php
<?php
// theme/lib/functions.php
defined('AUTOMAD') or die('Direct access not permitted!');

\\\\Automad\\\\Engine\\\\CustomFunction::add('t', function (array $options): string {
    $key = $options['key'] ?? '';
    $lang = $options['lang'] ?? '@{ :lang }';   // can be a template expression
    $strings = require __DIR__ . '/../i18n/strings.php';
    return $strings[$lang][$key] ?? $key;
});
\`\`\`

Then in a template:
\`\`\`
<@ t { key: 'welcome', lang: 'de' } @>
\`\`\`

## Loading order

- The registration must happen **before** Automad renders any template that
  uses the function. The safe place is \`lib/functions.php\` (loaded by the theme
  on every request).
- \`require\` at the top of \`lib/functions.php\` re-evaluates on every page load
  (cheap, fine for small \`i18n/strings.php\` arrays).
- For larger translation tables, lazy-load inside the closure:
  \`$strings = require __DIR__ . '/../i18n/strings.php';\` inside the function
  body keeps the table out of every request's memory until needed.

## Why the registry?

The template engine parses \`<@ name { ... } @>\` tokens and dispatches by name.
Without \`CustomFunction::add\`, the parser would have to inspect every defined
PHP function in scope — a global lookup that's both slow and unsafe (any
function in any namespace would become template-callable).

## Verifying your registration works

Quick smoke test: \`automad_theme.analyze\` on your theme should NOT warn about
unrecognized function names. If you see "function \`t\` not registered", the
registration didn't run before the analyzer.
`,
};
