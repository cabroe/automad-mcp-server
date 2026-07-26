import type { DocPage } from '../../kb.js';

export const page: DocPage = {
  slug: 'common-pitfalls',
  title: 'Common pitfalls (v2 themes)',
  tags: ['pitfalls', 'debug', 'gotchas', 'include', 'snippet', 'lang', 'fpm'],
  reference: 'https://automad.org/developer-guide',
  body: `# Common pitfalls (v2 themes)

Hard-won lessons from real theme builds. Read this before chasing a "why does my
page render empty?" mystery.

## 1. Include paths are relative to the calling file
\`<@ include @>\` resolves relative to the *directory of the calling file*, NOT the
theme root. See \`include-path-resolution\` for the full rule.

## 2. Plain PHP functions are NOT callable from templates
\`function t() {}\` in \`lib/functions.php\` is invisible to the template engine. The
engine looks names up via a registry. See \`custom-functions\` for the
registration pattern.

## 3. \`:lang\` is a system runtime variable, not a page field
Setting \`textLanguage: "en"\` on a page does not change \`@{ :lang }\`. The
runtime \`:lang\` is set by Automad's \`I18n\` class from URL prefix
(\`/de/\`, \`/en/\`) when \`AM_I18N_ENABLED = true\` and the page lives under
\`pages/de/\` or \`pages/en/\`. See \`runtime-lang\`.

## 4. Page data must set BOTH \`theme\` AND \`template\`
Setting only \`theme: "my/theme"\` produces \`Template missing! my/theme/.php\`
(empty template name). Every page's \`data\` file must set both keys to be
renderable.

## 5. \`<@ main @>\` needs a snippet definition
If a template invokes \`<@ main @>\`, at least one \`<@~ snippet main ~@>\` must be
reachable in the call graph. The starter kit's pattern: \`default.php\` is the
document shell, page templates (e.g. \`default.php\`, \`pagelist.php\`) redefine
\`main\` to inject their content. See \`snippet-inheritance\`.

## 6. \`php-fpm\` ships with \`error_log = /dev/null\`
Container debug sessions that produce a 500 with empty body are usually an FPM
error that went nowhere. Patch \`/usr/local/etc/php-fpm.conf\` (or wherever the
image puts it) to a writable path like \`/tmp/php-fpm.log\` and tail it.

## 7. NEVER overwrite container files via heredoc
Running \`sh -c 'cat > /app/automad/init.php <<EOF ... EOF'\` inside a container
silently clobbers files with the heredoc body if the shell parses it
differently than expected. Use \`docker cp\` or \`docker exec -i ... bash -c "cat
> /path"\` (read from stdin) instead.

## 8. FPM workers cache edits under OPcache
After editing \`components/page.php\` the response may stay unchanged for >5s
even with \`revalidate_freq=2\`. Force worker respawn with
\`pkill -9 -f "php-fpm: pool"\` from inside the container.

## 9. The Automad docs URL has changed
Older blog posts and tooling link to \`https://automad.org/version-2/blocks\`
and friends — these all return 404. The real docs live at
\`/developer-guide/building-themes/*\` and \`/user-guide/*\`. Always check
\`https://automad.org/\` first.
`,
};
