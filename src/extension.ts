import * as vscode from 'vscode';

const extensionId = 'vscode-simple-start';
const configSection = 'simpleStart';
const projectsRootSetting = 'projectsRoot';
const openOnStartupSetting = 'openOnStartup';

let startPagePanel: vscode.WebviewPanel | undefined;

type ProjectItem = {
	name: string;
	path: string;
};

type StartPageState = {
	rootPath: string;
	projects: ProjectItem[];
	emptyMessage?: string;
	errorMessage?: string;
};

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(`${extensionId}.openStartPage`, async () => {
			await openStartPage(context);
		}),
		vscode.commands.registerCommand(`${extensionId}.selectProjectsRoot`, async () => {
			const didUpdate = await selectProjectsRoot();
			if (didUpdate && startPagePanel) {
				await renderStartPage(startPagePanel);
			}
		}),
		vscode.commands.registerCommand(`${extensionId}.refreshStartPage`, async () => {
			if (startPagePanel) {
				await renderStartPage(startPagePanel);
				return;
			}

			await openStartPage(context);
		})
	);

	if (shouldOpenOnStartup()) {
		void openStartPage(context);
	}
}

export function deactivate() {}

function shouldOpenOnStartup(): boolean {
	const config = vscode.workspace.getConfiguration(configSection);
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

	return config.get<boolean>(openOnStartupSetting, true)
		&& !vscode.workspace.workspaceFile
		&& workspaceFolders.length === 0;
}

async function openStartPage(context: vscode.ExtensionContext): Promise<void> {
	if (startPagePanel) {
		startPagePanel.reveal(vscode.ViewColumn.One);
		await renderStartPage(startPagePanel);
		return;
	}

	startPagePanel = vscode.window.createWebviewPanel(
		'simpleStart.startPage',
		'Simple Start',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: false
		}
	);

	startPagePanel.onDidDispose(() => {
		startPagePanel = undefined;
	}, null, context.subscriptions);

	startPagePanel.webview.onDidReceiveMessage(async (message: { command?: string; path?: string }) => {
		switch (message.command) {
			case 'chooseRoot':
				await selectProjectsRoot();
				if (startPagePanel) {
					await renderStartPage(startPagePanel);
				}
				break;
			case 'refresh':
				if (startPagePanel) {
					await renderStartPage(startPagePanel);
				}
				break;
			case 'openProject':
				if (typeof message.path === 'string' && message.path.length > 0) {
					await openProjectFolder(message.path);
				}
				break;
		}
	}, undefined, context.subscriptions);

	await renderStartPage(startPagePanel);
}

async function selectProjectsRoot(): Promise<boolean> {
	const selectedUris = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'Use as Projects Root'
	});

	const selectedRoot = selectedUris?.[0];
	if (!selectedRoot) {
		return false;
	}

	await vscode.workspace.getConfiguration(configSection).update(
		projectsRootSetting,
		selectedRoot.fsPath,
		vscode.ConfigurationTarget.Global
	);

	return true;
}

async function renderStartPage(panel: vscode.WebviewPanel): Promise<void> {
	const state = await loadStartPageState();
	panel.webview.html = getWebviewHtml(panel.webview, state);
}

async function loadStartPageState(): Promise<StartPageState> {
	const rootPath = getProjectsRoot();
	if (!rootPath) {
		return {
			rootPath: '',
			projects: [],
			emptyMessage: 'Choose a projects root to list your folders here.'
		};
	}

	const rootUri = vscode.Uri.file(rootPath);
	try {
		const rootStat = await vscode.workspace.fs.stat(rootUri);
		if ((rootStat.type & vscode.FileType.Directory) === 0) {
			return {
				rootPath,
				projects: [],
				errorMessage: 'The configured projects root is not a folder.'
			};
		}

		const entries = await vscode.workspace.fs.readDirectory(rootUri);
		const projects = entries
			.filter(([, fileType]) => fileType === vscode.FileType.Directory)
			.map(([name]) => ({
				name,
				path: vscode.Uri.joinPath(rootUri, name).fsPath
			}))
			.sort((left, right) => left.name.localeCompare(right.name));

		if (projects.length === 0) {
			return {
				rootPath,
				projects,
				emptyMessage: 'No folders were found directly inside the configured projects root.'
			};
		}

		return { rootPath, projects };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return {
			rootPath,
			projects: [],
			errorMessage: `Unable to read the configured projects root. ${message}`
		};
	}
}

function getProjectsRoot(): string {
	return vscode.workspace.getConfiguration(configSection).get<string>(projectsRootSetting, '').trim();
}

async function openProjectFolder(projectPath: string): Promise<void> {
	const projectUri = vscode.Uri.file(projectPath);

	try {
		const stat = await vscode.workspace.fs.stat(projectUri);
		if ((stat.type & vscode.FileType.Directory) === 0) {
			void vscode.window.showErrorMessage('The selected item is not a folder.');
			return;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		void vscode.window.showErrorMessage(`Unable to open the selected folder. ${message}`);
		return;
	}

	startPagePanel?.dispose();
	await vscode.commands.executeCommand('vscode.openFolder', projectUri, false);
}

function getWebviewHtml(webview: vscode.Webview, state: StartPageState): string {
	const nonce = getNonce();
	const escapedRoot = state.rootPath ? escapeHtml(state.rootPath) : 'Not configured';
	const projectCards = state.projects.map((project) => {
		const encodedPath = escapeHtml(project.path);
		const encodedName = escapeHtml(project.name);

		return `
			<button class="project-card" data-path="${encodedPath}">
				<span class="project-name">${encodedName}</span>
				<span class="project-path">${encodedPath}</span>
			</button>`;
	}).join('');

	const stateMarkup = state.errorMessage
		? `<section class="status status-error">${escapeHtml(state.errorMessage)}</section>`
		: state.emptyMessage
			? `<section class="status status-empty">${escapeHtml(state.emptyMessage)}</section>`
			: `<section class="project-list">${projectCards}</section>`;

	return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Simple Start</title>
			<style nonce="${nonce}">
				:root {
					color-scheme: light dark;
					--bg: #f5f1e8;
					--panel: rgba(255, 252, 247, 0.82);
					--panel-border: rgba(62, 45, 30, 0.16);
					--text: #2b2116;
					--muted: #6e5a46;
					--accent: #0c7c59;
					--accent-strong: #07513b;
					--error: #8f2d1e;
				}

				@media (prefers-color-scheme: dark) {
					:root {
						--bg: #161511;
						--panel: rgba(33, 28, 22, 0.88);
						--panel-border: rgba(255, 238, 219, 0.12);
						--text: #f3ecdf;
						--muted: #c9baa6;
						--accent: #6ed6ae;
						--accent-strong: #49b18a;
						--error: #ff9c8b;
					}
				}

				* {
					box-sizing: border-box;
				}

				body {
					margin: 0;
					min-height: 100vh;
					padding: 32px;
					font-family: Georgia, 'Times New Roman', serif;
					background:
						radial-gradient(circle at top left, rgba(12, 124, 89, 0.18), transparent 28%),
						radial-gradient(circle at bottom right, rgba(181, 111, 48, 0.18), transparent 30%),
						linear-gradient(135deg, var(--bg), #d9d1c2 160%);
					color: var(--text);
				}

				main {
					max-width: 980px;
					margin: 0 auto;
					padding: 28px;
					border: 1px solid var(--panel-border);
					border-radius: 28px;
					background: var(--panel);
					backdrop-filter: blur(12px);
					box-shadow: 0 24px 80px rgba(0, 0, 0, 0.12);
				}

				header {
					display: flex;
					flex-wrap: wrap;
					justify-content: space-between;
					gap: 20px;
					margin-bottom: 24px;
				}

				h1 {
					margin: 0 0 8px;
					font-size: clamp(2rem, 5vw, 4rem);
					line-height: 0.98;
					font-weight: 700;
				}

				p {
					margin: 0;
					max-width: 44rem;
					color: var(--muted);
					font-size: 1rem;
					line-height: 1.6;
				}

				.toolbar {
					display: flex;
					flex-wrap: wrap;
					gap: 12px;
					align-items: flex-start;
				}

				.toolbar button,
				.project-card {
					border: 0;
					cursor: pointer;
				}

				.toolbar button {
					padding: 12px 18px;
					border-radius: 999px;
					font: inherit;
					background: var(--accent);
					color: #fff;
					transition: transform 120ms ease, background 120ms ease;
				}

				.toolbar button.secondary {
					background: transparent;
					color: var(--text);
					border: 1px solid var(--panel-border);
				}

				.toolbar button:hover,
				.toolbar button:focus-visible,
				.project-card:hover,
				.project-card:focus-visible {
					transform: translateY(-1px);
				}

				.root-banner {
					margin-bottom: 20px;
					padding: 14px 18px;
					border-radius: 18px;
					background: rgba(255, 255, 255, 0.32);
					border: 1px solid var(--panel-border);
				}

				.root-label {
					display: block;
					margin-bottom: 4px;
					font-size: 0.78rem;
					letter-spacing: 0.12em;
					text-transform: uppercase;
					color: var(--muted);
				}

				.root-path {
					font-family: 'SFMono-Regular', Consolas, monospace;
					font-size: 0.95rem;
					word-break: break-all;
				}

				.project-list {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
					gap: 14px;
				}

				.project-card {
					display: flex;
					flex-direction: column;
					align-items: flex-start;
					gap: 8px;
					padding: 18px;
					border-radius: 20px;
					background: rgba(255, 255, 255, 0.44);
					border: 1px solid var(--panel-border);
					text-align: left;
					color: var(--text);
				}

				.project-name {
					font-size: 1.15rem;
					font-weight: 700;
				}

				.project-path {
					font-size: 0.86rem;
					line-height: 1.5;
					color: var(--muted);
					word-break: break-all;
				}

				.status {
					padding: 24px;
					border-radius: 20px;
					border: 1px dashed var(--panel-border);
					background: rgba(255, 255, 255, 0.28);
					font-size: 1rem;
					line-height: 1.6;
					color: var(--muted);
				}

				.status-error {
					color: var(--error);
				}

				@media (max-width: 640px) {
					body {
						padding: 16px;
					}

					main {
						padding: 20px;
						border-radius: 22px;
					}
				}
			</style>
		</head>
		<body>
			<main>
				<header>
					<div>
						<h1>Pick up where you left off.</h1>
						<p>Simple Start lists the folders directly inside your chosen projects root. Click one to open it in this window and move straight into work.</p>
					</div>
					<div class="toolbar">
						<button type="button" data-command="chooseRoot">Choose root</button>
						<button type="button" class="secondary" data-command="refresh">Refresh</button>
					</div>
				</header>
				<section class="root-banner">
					<span class="root-label">Projects root</span>
					<span class="root-path">${escapedRoot}</span>
				</section>
				${stateMarkup}
			</main>
			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();

				document.querySelectorAll('[data-command]').forEach((element) => {
					element.addEventListener('click', () => {
						vscode.postMessage({ command: element.getAttribute('data-command') });
					});
				});

				document.querySelectorAll('.project-card').forEach((element) => {
					element.addEventListener('click', () => {
						vscode.postMessage({
							command: 'openProject',
							path: element.getAttribute('data-path')
						});
					});
				});
			</script>
		</body>
		</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function getNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';

	for (let index = 0; index < 16; index += 1) {
		nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}

	return nonce;
}
