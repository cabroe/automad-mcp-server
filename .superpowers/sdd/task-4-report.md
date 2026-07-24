# Task 4: Config Loader Report

## Status
Complete.

## Commit
- `4823b39 feat(config): env loader with validation and write-mode guard`

## Implementation
- Added `src/config.ts` with strict `Config` and `WriteMode` types.
- Loads `AUTOMAD_URL`, `AUTOMAD_USER`, password/token credentials, `AUTOMAD_WRITE_MODE`, and `LOG_LEVEL` from `process.env`.
- Defaults write mode to `confirm-destructive` and log level to `info`.
- Validates required values, credential presence, and write-mode membership using `AutomadMcpError` with `VALIDATION` code.
- Added unit coverage in `tests/unit/config.test.ts` for defaults, modes, missing values, credentials, and log level.

## Test Summary
- `npx vitest run tests/unit/config.test.ts`: 10 passed.
- `npm run test:coverage -- --coverage.include=src/config.ts`: 18 total tests passed; config loader 100% statements, branches, functions, and lines.
- `npm run build`: passed.
- `npm run lint`: passed.

## Runtime Verification
Built package-boundary execution with `dist/config.js`:
- Valid environment produced JSON with URL, username, password, default mode, and default log level.
- Token-only environment produced JSON with token and no password.
- Invalid write mode produced `AutomadMcpError: Invalid write mode in AUTOMAD_WRITE_MODE: garbage...`.
- Missing both credentials produced `AutomadMcpError: Either AUTOMAD_PASS or AUTOMAD_TOKEN must be provided`.

## Concerns
None identified. The loader is a library component; the current repository entry point does not yet invoke it directly, so verification exercised the built package boundary rather than a running server surface.
