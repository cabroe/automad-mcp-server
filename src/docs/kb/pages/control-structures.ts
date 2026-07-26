import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "control-structures",
  title: "Control structures (set, with, foreach, if)",
  tags: ["foreach", "if", "with", "set", "loop", "context"],
  reference: "https://automad.org/developer-guide/building-themes/template-language/control-structures",
  body: `
## set — mutate the current context
\`\`\`
<@ set { :classArticle: 'card', :showFooter: true } @>
<@ set { filter: '{"checkboxShowInNavbar":"/[^0]+/"}', sort: 'date desc' } @>
<@~ set { :count: 6 } ~@>    <!-- ~ strips surrounding whitespace -->
\`\`\`

## with — switch context to another page or object
\`\`\`
<@ with '/contact' @>
  <h2>@{ :title }</h2>
<@ end @>

<@ with @{ imageLogo } @>
  <img src="@{ imageLogo }" alt="@{ :basename }">
<@ end @>
\`\`\`
\`:file\`, \`:fileResized\`, \`:basename\` exist **only** inside a \`with @{ image } { }\` block.

## foreach — iterate objects (pagelist, filelist, nav, breadcrumb)
Inside \`foreach in\`, loop variables use the \`:\` prefix.
\`\`\`
<@ foreach in pagelist @>
  <article>
    <h3>@{ :title }</h3>
    <a href="@{ :url }">Read more</a>
  </article>
<@ end @>
\`\`\`

| Variable | Meaning |
|---|---|
| \`:title\` / \`:url\` / \`:date\` | current page fields |
| \`:current\` | this page **is** the requested page |
| \`:currentPath\` | this page is **on the path** to the requested page |

## if — conditional
\`\`\`
<@ if @{ variable } @> yes <@ else @> no <@ end @>
<@ foreach in pagelist @>
  <li<@ if @{ :current } @> class="active"<@ end @>>
    <a href="@{ :url }">@{ :title }</a>
  </li>
<@ end @>
\`\`\``,
};
