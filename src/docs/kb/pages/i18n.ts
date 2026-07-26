import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "i18n",
  title: "Multilingual (i18n)",
  tags: ["i18n", "multilingual", "translation", "locale", "language"],
  reference: "https://automad.org/developer-guide/building-themes/template-language/multilingual-content",
  body: `# Multilingual (i18n)

Translation dictionaries live in \`i18n/<locale>.json\` inside the theme.

## Output a translation
\`\`\`
<@ t { key: "nav.products" } @>
<@ t { key: "msg.text", name: "Max" } @>   <!-- placeholder: 'Hallo {name}' -->
\`\`\`

## Language switch link
\`\`\`
<@ langSwitchLink @>
\`\`\`

## Dictionary file — i18n/de.json
\`\`\`json
{
  "nav.products": "Produkte",
  "msg.text": "Hallo {name}"
}
\`\`\`

Keep the key set identical across every \`i18n/*.json\` file — missing keys in one
locale fall back to the key string. \`automad_theme.validate\` flags empty i18n
directories and duplicate locales.
`,
};
