## What

<!-- One-sentence summary of the change. -->

## Why

<!-- Bug, feature, refactor — link the issue if there is one. -->

## How

<!-- The interesting part: which files moved, which contract changed. -->

## Risk

<!-- What could break? What is the blast radius? -->

## Verification

<!-- Be specific. "I ran the tests" is not enough; name the suite(s). -->

- [ ] `npm run lint` — clean
- [ ] `npm run build` — `tsc` clean
- [ ] `npm test` — unit suite green
- [ ] `npm run e2e:run` — live suite green (if the change touched live paths)
- [ ] New coverage added where it defended a real contract, not the diff

## Checklist

- [ ] `CHANGELOG.md` updated if user-visible
- [ ] `CLAUDE.md` updated if architecture, conventions, or commands changed
- [ ] `docs/index.html` regenerated if the tool table / counts moved
- [ ] No new TODOs left in shipped code
- [ ] Commit message follows Conventional Commits (`feat(scope): …`)
