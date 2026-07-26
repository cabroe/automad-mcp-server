import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "blocks",
  title: "Blocks",
  tags: ["blocks", "editor", "pagelist", "section", "columns", "content"],
  reference: "https://automad.org/user-guide/using-blocks",
  body: `# Blocks

Content is authored in the block editor and rendered where a template places a
\`@{ +field }\` region.

## Core blocks (v2)

| Type | Renders | Key properties |
|---|---|---|
| \`paragraph\` | Rich text (paragraphs, inline marks, links) | — |
| \`header\` | Heading (levels 1–6) | level |
| \`image\` | Single image with optional caption/link | \`url\`, \`alt\`, \`caption\`, \`link\` |
| \`image-slideshow\` | Carousel of images with autoplay/effects | \`files\`, \`loop\`, \`autoplay\`, \`effect\`, \`delay\`, \`breakpoints\` |
| \`gallery\` | Grid of images (see \`blocks/gallery/*.php\` for variants) | — |
| \`video\` | Native HTML5 video | \`url\`, \`caption\` |
| \`embed\` | oEmbed (YouTube, Vimeo, etc.) | \`service\`, \`embed\`, \`width\`, \`height\`, \`caption\` |
| \`filelist\` | List of files in a directory (see templates under \`blocks/filelist/\`) | — |
| \`code\` | Syntax-highlighted code block | language |
| \`quote\` | Blockquote with optional attribution | — |
| \`callout\` | Highlighted info/warn/success box | style |
| \`delimiter\` | Horizontal separator | — |
| \`buttons\` | Row of buttons | \`justify\`, \`gap\` |
| \`mail\` | Mailto link / contact card | \`to\` |
| \`layout-section\` | Full-width container for grouping blocks (with style + flex controls) | \`content\`, \`style\`, \`gap\`, \`justify\`, \`align\` |
| \`nested-list\` | Bulleted/numbered list (nested) | — |
| \`table\` | Tabular data (rows/cols) | \`content\` |
| \`table-of-contents\` | Auto-generated ToC from headings | — |
| \`pagelist\` | List of child pages, tag pages, or search results | \`context\` (children/tags/search), \`filter\`, \`limit\`, \`offset\`, \`template\`, \`type\`, \`file\` |
| \`snippet\` | Include another template (file or named snippet) | \`snippet\`, \`file\` |
| \`component\` | Render a registered component by name | — |
| \`collapsible-section\` | Expandable content block (accordion-style) | \`title\`, \`collapsed\`, \`group\`, \`content\` |
| \`raw\` | Raw HTML (sanitized on output) | html |
| \`tex\` | LaTeX/math expression (rendered via KaTeX/MathJax by the frontend) | formula |

(Source: \`automad/automad:v2\` \`/app/automad/src/server/Blocks/*.php\` — verified live.)

## Rendering blocks

\`\`\`
<div class="content">
  @{ +main }
</div>
\`\`\`

## Declaring block fields in theme.json

\`\`\`json
{
  "masks": { "page": ["+main"], "shared": [] },
  "fieldOrder": ["+main"],
  "tooltips": { "+main": "Main content area" }
}
\`\`\`

## Customizing block markup

Per-block templates live under \`blocks/<type>/*.php\` (e.g. \`blocks/pagelist/blog.php\`)
and receive the current context. Set variant classes with \`set\` before including:

\`\`\`
<@ set { :classes: 'cards masonry' } @>
<@ blocks/pagelist/blog.php @>
\`\`\`

## Per-block templates (Starter Kit)

The Automad Theme Starter Kit ships example templates you can copy and adapt:

\`\`\`
blocks/
  pagelist/
    grid.php        # default grid layout for the pagelist block
\`\`\`

Add a new variant by creating \`blocks/<type>/<variant>.php\` in your theme; the
dashboard lets the editor pick the variant per block instance.
`,
};
