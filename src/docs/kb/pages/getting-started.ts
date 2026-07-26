import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "getting-started",
  title: "Getting started",
  tags: ["install", "docker", "packages", "setup", "requirements"],
  reference: "https://automad.org/getting-started",
  body: `
## Docker (fastest)
\`\`\`
docker run -dp 8080:80 automad/automad:v2
\`\`\`
Open http://localhost:8080/dashboard and create the first user.

## Requirements
- PHP with \`short_open_tag = On\`
- Write access to the site directory (pages, cache, packages)

## Installing themes/packages
Themes live under \`packages/<vendor>/<name>\`. Install from the dashboard
(Packages) or drop a theme directory into \`packages/\`. With this MCP server, use
\`automad_theme\` (scaffold/install/build/activate) against \`AUTOMAD_THEMES_PATH\`.

## Minimal theme
\`\`\`
packages/my/theme/
  theme.json        # { "name": "My Theme", "masks": { "shared": ["+main"] } }
  default.php       # <@ components/page.php @>
  components/page.php
\`\`\`
\`\`\`php
<!-- components/page.php -->
<!DOCTYPE html>
<html lang="@{ :lang | def('en') }">
  <body>@{ +main }</body>
</html>
\`\`\``,
};
