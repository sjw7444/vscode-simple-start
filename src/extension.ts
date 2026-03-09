import * as vscode from 'vscode';

const extensionId = 'vscode-simple-start';
const configSection = 'simpleStart';
const projectsRootSetting = 'projectsRoot';
const openOnStartupSetting = 'openOnStartup';
const replaceDefaultStartupPageSetting = 'replaceDefaultStartupPage';

let startPagePanel: vscode.WebviewPanel | undefined;
const projectIconCache = new Map<string, string | null>();

type ProjectItem = {
	name: string;
	path: string;
	iconPath?: string;
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
			clearProjectIconCache();

			if (startPagePanel) {
				await renderStartPage(startPagePanel);
				return;
			}

			await openStartPage(context);
		})
	);

	if (shouldOpenOnStartup()) {
		void prepareStartupSurface().then(() => openStartPage(context));
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

async function prepareStartupSurface(): Promise<void> {
	const config = vscode.workspace.getConfiguration(configSection);
	if (!config.get<boolean>(replaceDefaultStartupPageSetting, false)) {
		return;
	}

	const workbenchConfig = vscode.workspace.getConfiguration('workbench');
	const startupEditor = workbenchConfig.get<string>('startupEditor');
	if (startupEditor !== 'none') {
		await workbenchConfig.update('startupEditor', 'none', vscode.ConfigurationTarget.Global);
	}

	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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

	clearProjectIconCache();

	await vscode.workspace.getConfiguration(configSection).update(
		projectsRootSetting,
		selectedRoot.fsPath,
		vscode.ConfigurationTarget.Global
	);

	return true;
}

async function renderStartPage(panel: vscode.WebviewPanel): Promise<void> {
	const state = await loadStartPageState();
	panel.webview.options = {
		enableScripts: true,
		localResourceRoots: state.rootPath ? [vscode.Uri.file(state.rootPath)] : []
	};
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
		const projects = await Promise.all(entries
			.filter(([, fileType]) => fileType === vscode.FileType.Directory)
			.map(([name]) => ({
				name,
				path: vscode.Uri.joinPath(rootUri, name).fsPath
			}))
			.sort((left, right) => left.name.localeCompare(right.name))
			.map(async (project) => ({
				...project,
				iconPath: await resolveProjectIconPath(vscode.Uri.file(project.path))
			})));

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

function clearProjectIconCache(): void {
	projectIconCache.clear();
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
	const projectCount = state.projects.length;
	const projectCards = state.projects.map((project) => {
		const encodedPath = escapeHtml(project.path);
		const encodedName = escapeHtml(project.name);
		const projectVisual = project.iconPath
			? `<img class="project-icon" src="${escapeHtml(webview.asWebviewUri(vscode.Uri.file(project.iconPath)).toString())}" alt="" loading="lazy">`
			: `<span class="project-mark" aria-hidden="true">${getProjectInitial(project.name)}</span>`;

		return `
			<button class="project-card" data-path="${encodedPath}">
				${projectVisual}
				<span class="project-name">${encodedName}</span>
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
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Simple Start</title>
			<style nonce="${nonce}">
				:root {
					color-scheme: light dark;
					--bg: #efe5d3;
					--bg-deep: #d9c3a6;
					--panel: rgba(255, 249, 240, 0.8);
					--panel-strong: rgba(255, 252, 247, 0.94);
					--panel-border: rgba(71, 45, 19, 0.14);
					--text: #24170f;
					--muted: #735843;
					--accent: #0e7a5f;
					--accent-strong: #0a5f49;
					--accent-soft: rgba(14, 122, 95, 0.14);
					--shadow: 0 24px 80px rgba(66, 37, 8, 0.16);
					--error: #8f2d1e;
				}

				@media (prefers-color-scheme: dark) {
					:root {
						--bg: #13100d;
						--bg-deep: #23180f;
						--panel: rgba(31, 24, 18, 0.8);
						--panel-strong: rgba(41, 31, 23, 0.94);
						--panel-border: rgba(252, 228, 197, 0.11);
						--text: #f7efdf;
						--muted: #cfbea8;
						--accent: #74d5b0;
						--accent-strong: #52b893;
						--accent-soft: rgba(116, 213, 176, 0.14);
						--shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
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
						radial-gradient(circle at 0% 0%, rgba(14, 122, 95, 0.24), transparent 24%),
						radial-gradient(circle at 100% 100%, rgba(201, 121, 35, 0.22), transparent 26%),
						linear-gradient(140deg, var(--bg), var(--bg-deep) 180%);
					color: var(--text);
				}

				main {
					max-width: 980px;
					margin: 0 auto;
					padding: 34px;
					border: 1px solid var(--panel-border);
					border-radius: 30px;
					background: linear-gradient(180deg, var(--panel-strong), var(--panel));
					backdrop-filter: blur(12px);
					box-shadow: var(--shadow);
					position: relative;
					overflow: hidden;
				}

				main::before {
					content: '';
					position: absolute;
					inset: 0 auto auto 0;
					width: 260px;
					height: 260px;
					background: radial-gradient(circle, var(--accent-soft), transparent 68%);
					pointer-events: none;
				}

				header {
					display: grid;
					grid-template-columns: minmax(0, 1fr) auto;
					gap: 20px;
					align-items: start;
					margin-bottom: 28px;
					position: relative;
					z-index: 1;
				}

				.kicker {
					display: inline-flex;
					align-items: center;
					gap: 8px;
					padding: 7px 12px;
					margin-bottom: 14px;
					border-radius: 999px;
					background: var(--accent-soft);
					color: var(--accent-strong);
					font-size: 0.82rem;
					font-weight: 700;
					letter-spacing: 0.08em;
					text-transform: uppercase;
				}

				h1 {
					margin: 0 0 8px;
					font-size: clamp(2.3rem, 5vw, 4.6rem);
					line-height: 0.92;
					font-weight: 700;
					max-width: 12ch;
				}

				p {
					margin: 0;
					max-width: 42rem;
					color: var(--muted);
					font-size: 1.04rem;
					line-height: 1.6;
				}

				.hero-meta {
					display: grid;
					gap: 10px;
					justify-items: end;
				}

				.project-count {
					display: inline-flex;
					align-items: baseline;
					gap: 8px;
					padding: 16px 18px;
					border-radius: 22px;
					background: rgba(255, 255, 255, 0.34);
					border: 1px solid var(--panel-border);
				}

				.project-count strong {
					font-size: clamp(1.8rem, 4vw, 2.8rem);
					line-height: 1;
				}

				.project-count span {
					color: var(--muted);
					font-size: 0.95rem;
				}

				.toolbar {
					display: flex;
					flex-wrap: wrap;
					gap: 12px;
					align-items: center;
					justify-content: space-between;
					margin-top: 28px;
					padding-top: 22px;
					border-top: 1px solid var(--panel-border);
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
					background: linear-gradient(180deg, var(--accent), var(--accent-strong));
					color: #fff;
					box-shadow: 0 10px 26px rgba(14, 122, 95, 0.18);
					transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
				}

				.toolbar button.secondary {
					background: transparent;
					color: var(--text);
					border: 1px solid var(--panel-border);
					box-shadow: none;
				}

				.toolbar button:hover,
				.toolbar button:focus-visible,
				.project-card:hover,
				.project-card:focus-visible {
					transform: translateY(-2px);
				}

				.toolbar button:hover,
				.toolbar button:focus-visible {
					box-shadow: 0 14px 30px rgba(14, 122, 95, 0.24);
				}

				.root-banner {
					flex: 1 1 320px;
					padding: 16px 18px;
					border-radius: 20px;
					background: rgba(255, 255, 255, 0.26);
					border: 1px solid var(--panel-border);
				}

				.toolbar-actions {
					display: flex;
					flex-wrap: wrap;
					gap: 12px;
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
					gap: 16px;
					position: relative;
					z-index: 1;
				}

				.project-card {
					display: flex;
					flex-direction: column;
					align-items: flex-start;
					gap: 10px;
					padding: 18px;
					border-radius: 24px;
					background: linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.24));
					border: 1px solid var(--panel-border);
					text-align: left;
					color: var(--text);
					min-height: 150px;
					justify-content: space-between;
					transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
				}

				.project-card:hover,
				.project-card:focus-visible {
					border-color: rgba(14, 122, 95, 0.3);
					background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.34));
				}

				.project-mark {
					display: inline-grid;
					place-items: center;
					width: 42px;
					height: 42px;
					border-radius: 14px;
					background: var(--accent-soft);
					color: var(--accent-strong);
					font-size: 1rem;
					font-weight: 700;
					text-transform: uppercase;
				}

				.project-icon {
					width: 42px;
					height: 42px;
					border-radius: 14px;
					object-fit: cover;
					background: rgba(255, 255, 255, 0.22);
					border: 1px solid rgba(0, 0, 0, 0.04);
				}

				.project-name {
					font-size: 1.18rem;
					font-weight: 700;
					line-height: 1.3;
				}

				.project-open {
					font-size: 0.88rem;
					font-weight: 700;
					letter-spacing: 0.04em;
					text-transform: uppercase;
					color: var(--accent-strong);
				}

				.status {
					padding: 24px;
					border-radius: 22px;
					border: 1px dashed var(--panel-border);
					background: rgba(255, 255, 255, 0.24);
					font-size: 1rem;
					line-height: 1.6;
					color: var(--muted);
					position: relative;
					z-index: 1;
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

					header {
						grid-template-columns: 1fr;
					}

					.hero-meta {
						justify-items: start;
					}

					.toolbar {
						align-items: stretch;
					}

					.toolbar-actions {
						width: 100%;
					}

					.toolbar-actions button {
						flex: 1 1 auto;
					}
				}
			</style>
		</head>
		<body>
			<main>
				<header>
					<div>
						<span class="kicker">Launchpad</span>
						<h1>Pick up where you left off</h1>
					</div>
					<div class="hero-meta">
						<div class="project-count">
							<strong>${projectCount}</strong>
							<span>${projectCount === 1 ? 'project ready' : 'projects ready'}</span>
						</div>
					</div>
				</header>
				${stateMarkup}
				<section class="toolbar">
					<div class="root-banner">
						<span class="root-label">Projects root</span>
						<span class="root-path">${escapedRoot}</span>
					</div>
					<div class="toolbar-actions">
						<button type="button" data-command="chooseRoot">Choose root</button>
						<button type="button" class="secondary" data-command="refresh">Refresh</button>
					</div>
				</section>
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

function getProjectInitial(name: string): string {
	const trimmed = name.trim();
	return trimmed.length > 0 ? trimmed.charAt(0) : '?';
}

async function resolveProjectIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	if (projectIconCache.has(projectUri.fsPath)) {
		return projectIconCache.get(projectUri.fsPath) ?? undefined;
	}

	const iconPath = await findProjectIconPath(projectUri);
	projectIconCache.set(projectUri.fsPath, iconPath ?? null);
	return iconPath;
}

async function findProjectIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	const iosIconPath = await findIosProjectIconPath(projectUri);
	if (iosIconPath) {
		return iosIconPath;
	}

	for (const relativePath of getWebsiteIconCandidates()) {
		const iconUri = vscode.Uri.joinPath(projectUri, ...relativePath.split('/'));
		if (await isFile(iconUri)) {
			return iconUri.fsPath;
		}
	}

	return undefined;
}

async function findIosProjectIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	const iosFolderUri = vscode.Uri.joinPath(projectUri, 'ios');
	if (!await isDirectory(iosFolderUri)) {
		return undefined;
	}

	for (const relativePath of await getIosIconSetCandidates(iosFolderUri)) {
		const iconSetUri = vscode.Uri.joinPath(iosFolderUri, ...relativePath.split('/'));
		if (!await isDirectory(iconSetUri)) {
			continue;
		}

		const selectedIcon = await selectBestIconFromSet(iconSetUri);
		if (selectedIcon) {
			return selectedIcon.fsPath;
		}
	}

	return undefined;
}

function getWebsiteIconCandidates(): string[] {
	return [
		'favicon.ico',
		'favicon.png',
		'public/favicon.ico',
		'public/favicon.png',
		'public/apple-touch-icon.png',
		'src/favicon.ico',
		'src/favicon.png',
		'app/favicon.ico',
		'app/favicon.png',
		'app/icon.png',
		'app/icon.svg'
	];
}

async function getIosIconSetCandidates(iosFolderUri: vscode.Uri): Promise<string[]> {
	const candidatePaths = new Set<string>([
		'Runner/Assets.xcassets/AppIcon.appiconset',
		'Runner/Images.xcassets/AppIcon.appiconset',
		'App/App/Assets.xcassets/AppIcon.appiconset',
		'App/App/Images.xcassets/AppIcon.appiconset'
	]);

	try {
		const iosEntries = await vscode.workspace.fs.readDirectory(iosFolderUri);
		for (const [name, fileType] of iosEntries) {
			if (fileType !== vscode.FileType.Directory) {
				continue;
			}

			candidatePaths.add(`${name}/Assets.xcassets/AppIcon.appiconset`);
			candidatePaths.add(`${name}/Images.xcassets/AppIcon.appiconset`);
			candidatePaths.add(`${name}/${name}/Assets.xcassets/AppIcon.appiconset`);
			candidatePaths.add(`${name}/${name}/Images.xcassets/AppIcon.appiconset`);
			candidatePaths.add(`${name}/App/Assets.xcassets/AppIcon.appiconset`);
			candidatePaths.add(`${name}/App/Images.xcassets/AppIcon.appiconset`);
		}
	} catch {
		return [...candidatePaths];
	}

	return [...candidatePaths];
}

async function selectBestIconFromSet(iconSetUri: vscode.Uri): Promise<vscode.Uri | undefined> {
	const contentsIcon = await selectIconFromContentsJson(iconSetUri);
	if (contentsIcon) {
		return contentsIcon;
	}

	try {
		const entries = await vscode.workspace.fs.readDirectory(iconSetUri);
		const iconFiles = entries
			.filter(([name, fileType]) => fileType === vscode.FileType.File && /\.(png|jpg|jpeg)$/i.test(name))
			.map(([name]) => name)
			.sort((left, right) => scoreIconName(right) - scoreIconName(left));

		return iconFiles[0] ? vscode.Uri.joinPath(iconSetUri, iconFiles[0]) : undefined;
	} catch {
		return undefined;
	}
}

async function selectIconFromContentsJson(iconSetUri: vscode.Uri): Promise<vscode.Uri | undefined> {
	const contentsUri = vscode.Uri.joinPath(iconSetUri, 'Contents.json');
	if (!await isFile(contentsUri)) {
		return undefined;
	}

	try {
		const fileContents = await vscode.workspace.fs.readFile(contentsUri);
		const parsed = JSON.parse(new TextDecoder().decode(fileContents)) as { images?: Array<{ filename?: string }> };
		const filenames = (parsed.images ?? [])
			.map((image) => image.filename)
			.filter((filename): filename is string => typeof filename === 'string' && filename.length > 0)
			.sort((left, right) => scoreIconName(right) - scoreIconName(left));

		for (const filename of filenames) {
			const iconUri = vscode.Uri.joinPath(iconSetUri, filename);
			if (await isFile(iconUri)) {
				return iconUri;
			}
		}
	} catch {
		return undefined;
	}

	return undefined;
}

function scoreIconName(filename: string): number {
	const numericMatches = [...filename.matchAll(/(\d+)/g)].map((match) => Number.parseInt(match[1], 10));
	const numericScore = numericMatches.length > 0 ? Math.max(...numericMatches) : 0;
	const pngBonus = filename.endsWith('.png') ? 500 : 0;
	const appIconBonus = /appicon|icon/i.test(filename) ? 100 : 0;

	return pngBonus + appIconBonus + numericScore;
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return (stat.type & vscode.FileType.Directory) !== 0;
	} catch {
		return false;
	}
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return (stat.type & vscode.FileType.File) !== 0;
	} catch {
		return false;
	}
}
