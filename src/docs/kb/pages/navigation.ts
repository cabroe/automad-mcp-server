import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "navigation",
  title: "Navigation",
  tags: ["nav", "navtree", "breadcrumbs", "pagelist", "menu", "recursive"],
  reference: "https://automad.org/developer-guide/building-themes/template-language/recursive-navigations",
  body: `
## Helpers
\`\`\`
<@ navTree @>         <!-- full navigation tree -->
<@ breadcrumbs @>     <!-- breadcrumb trail -->
<@ newPagelist { type: 'children' } @>
\`\`\`

## Pagelist with a loop
\`\`\`
<@ newPagelist { type: 'children', sort: 'date desc' } @>
<@ foreach in pagelist @>
  <a href="@{ :url }">@{ :title }</a>
<@ end @>
\`\`\`

## Recursive menu snippet
A snippet may call itself for nested menus.
\`\`\`
<@ snippet tree @>
  <ul>
    <@ foreach in pagelist @>
      <li<@ if @{ :current } @> class="active"<@ end @>>
        <a href="@{ :url }">@{ :title }</a>
        <@ if @{ :currentPath } @>
          <@ tree @>            <!-- recurse into open branch -->
        <@ end @>
      </li>
    <@ end @>
  </ul>
<@ end @>

<nav>
  <@ newPagelist { type: 'children' } @>
  <@ tree @>
</nav>
\`\`\`

\`:current\` = "this is the current page"; \`:currentPath\` = "this page is on the
way to the current page" (keeps the branch open).`,
};
