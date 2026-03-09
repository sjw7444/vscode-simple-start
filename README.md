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

## Known Issues

- The project list is intentionally shallow: only the immediate child folders of the configured projects root are shown.
- Opening a folder reloads the VS Code window, which also closes the start page. That is expected behavior for `vscode.openFolder`.

## Release Notes

### 0.0.1

Initial implementation of the custom startup page workflow.
