# Contributing To simple-start

Thanks for helping improve `simple-start`.

## Development Setup

1. Fork and clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Build and lint:

```bash
npm run compile
npm run lint
```

4. Launch extension development host:

- Open this repo in VS Code.
- Press `F5`.

## Project Structure

- `src/extension.ts`: extension entry point, webview UI, project and icon logic
- `src/test/`: extension tests
- `README.md`: user documentation
- `CHANGELOG.md`: release notes

## Workflow Expectations

- Keep changes focused and small.
- Add or update docs when behavior changes.
- Prefer ASCII unless the file already requires Unicode.
- Do not commit generated artifacts unless maintainers request it.

## Code Quality

Before opening a PR, run:

```bash
npm run compile
npm run lint
npm test
```

If tests are not available for your change, include manual verification steps in the PR description.

## UI And UX Changes

For start page UI updates:

- Keep layout responsive on desktop and mobile widths.
- Preserve accessibility basics (visible focus states, sufficient contrast, semantic controls).
- Avoid introducing remote resources in webview content.

## Icon Resolution Changes

For icon logic updates:

- Prefer deterministic, local path heuristics.
- Preserve the high-resolution ranking behavior.
- Keep scans bounded by depth and directory ignore lists for performance.
- Validate fallback behavior for projects without icon files.

## Pull Request Checklist

- [ ] Change is scoped and documented.
- [ ] `npm run compile` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes (or reason provided).
- [ ] README/CHANGELOG updated when user-facing behavior changed.

## Commit Messages

Use clear imperative commits, for example:

- `Improve website icon ranking for high-res assets`
- `Add app icon map docs and examples`

## Reporting Bugs And Feature Requests

Please include:

- VS Code version
- Extension version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if UI-related
