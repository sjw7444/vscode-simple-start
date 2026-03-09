# simple-start

simple-start replaces the stock "hello world" sample with a custom startup page for empty VS Code windows.

When VS Code launches without an open folder or workspace, the extension can show a start page that:

- Reads a configured projects root folder.
- Lists the immediate child folders under that root.
- Opens the clicked folder in the current window.
- Closes the start page as part of the folder-open transition.

## Features

- Startup-aware behavior: the page opens only for empty-window launches when enabled.
- Configurable projects root: point the extension at the parent folder that contains your projects.
- Fast local icons: cards can use common iOS, Android, macOS, Electron, and web icon layouts when they are found in standard project locations.
- Shared app icon map: define common application names once and prioritize icon paths for all matching projects.
- One-click project open: clicking a listed folder reuses the current VS Code window.
- Manual recovery commands: reopen the page, change the root folder, or refresh the listing from the Command Palette.

## Extension Settings

This extension contributes the following settings:

- `simpleStart.openOnStartup`: Open the start page when VS Code starts with no folder or workspace open and `workbench.startupEditor` is set to `none`.
- `simpleStart.projectsRoot`: Absolute path to the folder that contains the project folders you want to list.
- `simpleStart.applicationIconMap`: Object map of app names to icon candidate paths relative to each project folder.

Example:

```json
"simpleStart.applicationIconMap": {
	"shopper": [
		"assets/icon.png",
		"ios/Runner/Assets.xcassets/AppIcon.appiconset",
		"android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"
	],
	"admin": [
		"public/favicon.png",
		"build/icon.png"
	]
}
```

The key is matched against project folder names (`admin-portal` matches `admin`), so this is a simple way to maintain a common app catalog and improve icon hit-rate across related repos.

## Commands

- `simple-start: Open Start Page`
- `simple-start: Select Projects Root`
- `simple-start: Refresh Start Page`

## Development

- `npm run compile`: Compile the TypeScript extension.
- `npm run watch`: Rebuild on file changes.
- `npm run package:vsix`: Create a `.vsix` package for local installation.
- Press `F5` in VS Code to launch the Extension Development Host.

## Run The Extension

1. Open this repository in VS Code.
2. Press `F5` to start the `Run Extension` debug configuration.
3. In the Extension Development Host window, make sure no folder or workspace is open.
4. If the start page does not open automatically, run `simple-start: Open Start Page` from the Command Palette.
5. Use `Choose root` on the page, or set `simpleStart.projectsRoot` in Settings.
6. Click one of the listed folders to open that project in the current window.

If you want simple-start to be the startup surface, set `Workbench: Startup Editor` to `none`. This extension uses that built-in VS Code setting as the signal to auto-open the page in empty windows.

## Test The Behavior

Manual checks:

1. Start with an empty window and confirm the start page appears.
2. Set a valid projects root and confirm only immediate child folders are listed.
3. Click a listed folder and confirm VS Code opens it in the same window.
4. Start VS Code with a folder already open and confirm the start page does not appear.
5. Set an invalid projects root and confirm the page shows a recoverable error state.

Automated checks:

1. Run `npm run compile`.
2. Run `npm run lint`.
3. Run `npm test`.

## Publish

This extension can be distributed in three ways:

- Visual Studio Marketplace for standard VS Code installs.
- Open VSX for VS Code-compatible editors that do not use the Microsoft marketplace.
- A `.vsix` package for manual installation in editors such as Cursor.

### One-time setup

1. Create a publisher named `ElectricPants` in the Visual Studio Marketplace.
2. Create an Open VSX namespace that matches your publishing account.
3. Create access tokens for both services.
4. Log in before publishing:

```bash
npx vsce login ElectricPants
npx ovsx create-namespace ElectricPants
npx ovsx publish --pat <OPEN_VSX_TOKEN>
```

If you prefer not to store credentials in the CLI, you can pass them per command:

```bash
npx vsce publish --pat <VS_MARKETPLACE_TOKEN>
npx ovsx publish --pat <OPEN_VSX_TOKEN>
```

### Release workflow

1. Update `version` in `package.json`.
2. Add release notes in `CHANGELOG.md`.
3. Push the version bump to `main`.
4. Create and push a matching tag such as `v0.0.1`.
5. GitHub Actions validates that the tag matches `package.json` and that the tagged commit is on `main`.
6. GitHub Actions runs compile, lint, packaging, publishes to both registries, and attaches the `.vsix` to a GitHub release.

Commands:

```bash
git checkout main
git pull
git tag v0.0.1
git push origin v0.0.1
```

Required GitHub repository secrets:

- `VSCE_PAT`: Visual Studio Marketplace personal access token.
- `OVSX_PAT`: Open VSX access token.

The workflow file is `.github/workflows/release.yml`.

### Cursor compatibility

Cursor can install standard VS Code extensions when they are distributed as a `.vsix`, and many builds can also consume Open VSX distributions. The safest compatibility path is:

1. Keep the extension on stable VS Code APIs.
2. Publish to Open VSX.
3. Ship a `.vsix` artifact with each release.

## Known Issues

- The project list is intentionally shallow: only the immediate child folders of the configured projects root are shown.
- Project icons use fast local heuristics, not deep scans. Projects outside common iOS/Android/macOS/Electron/web icon layouts fall back to the letter badge.
- Opening a folder reloads the VS Code window, which also closes the start page. That is expected behavior for `vscode.openFolder`.
- Extensions cannot add a custom value to VS Code's built-in `Workbench: Startup Editor` selector, so simple-start uses `none` as the opt-in launch signal instead.

## Release Notes

### 0.0.1

Initial implementation of the custom startup page workflow.
