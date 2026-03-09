# Simple Start

Simple Start replaces the stock "hello world" sample with a custom startup page for empty VS Code windows.

When VS Code launches without an open folder or workspace, the extension can show a start page that:

- Reads a configured projects root folder.
- Lists the immediate child folders under that root.
- Opens the clicked folder in the current window.
- Closes the start page as part of the folder-open transition.

## Features

- Startup-aware behavior: the page opens only for empty-window launches when enabled.
- Configurable projects root: point the extension at the parent folder that contains your projects.
- One-click project open: clicking a listed folder reuses the current VS Code window.
- Manual recovery commands: reopen the page, change the root folder, or refresh the listing from the Command Palette.

## Extension Settings

This extension contributes the following settings:

- `simpleStart.replaceDefaultStartupPage`: Sets `workbench.startupEditor` to `none` so the built-in Welcome page does not compete with Simple Start in empty windows.
- `simpleStart.openOnStartup`: Open the start page when VS Code starts with no folder or workspace open.
- `simpleStart.projectsRoot`: Absolute path to the folder that contains the project folders you want to list.

## Commands

- `Simple Start: Open Start Page`
- `Simple Start: Select Projects Root`
- `Simple Start: Refresh Start Page`

## Development

- `npm run compile`: Compile the TypeScript extension.
- `npm run watch`: Rebuild on file changes.
- Press `F5` in VS Code to launch the Extension Development Host.

## Run The Extension

1. Open this repository in VS Code.
2. Press `F5` to start the `Run Extension` debug configuration.
3. In the Extension Development Host window, make sure no folder or workspace is open.
4. If the start page does not open automatically, run `Simple Start: Open Start Page` from the Command Palette.
5. Use `Choose root` on the page, or set `simpleStart.projectsRoot` in Settings.
6. Click one of the listed folders to open that project in the current window.

If you want Simple Start instead of the built-in Welcome page, enable `simpleStart.replaceDefaultStartupPage` in Settings. That updates VS Code's `workbench.startupEditor` setting to `none`.

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

## Known Issues

- The project list is intentionally shallow: only the immediate child folders of the configured projects root are shown.
- Opening a folder reloads the VS Code window, which also closes the start page. That is expected behavior for `vscode.openFolder`.
- `simpleStart.replaceDefaultStartupPage` changes the global `workbench.startupEditor` setting to `none`. Disabling the setting later does not automatically restore your previous startup editor preference.

## Release Notes

### 0.0.1

Initial implementation of the custom startup page workflow.
