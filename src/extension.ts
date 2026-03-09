import * as vscode from 'vscode';

const extensionId = 'simple-start';
const configSection = 'simpleStart';
const projectsRootSetting = 'projectsRoot';
const openOnStartupSetting = 'openOnStartup';
const applicationIconMapSetting = 'applicationIconMap';

let startPagePanel: vscode.WebviewPanel | undefined;
const projectIconCache = new Map<string, string | null>();

type ProjectItem = {
	name: string;
	path: string;
	iconPath?: string;
};

type ProjectType = 'nextjs' | 'electron' | 'flutter' | 'apple' | 'android' | 'node' | 'python' | 'api' | 'web' | 'generic';

type ApplicationIconMap = Record<string, string[]>;

const defaultApplicationIconMap: ApplicationIconMap = {
	react: ['public/logo192.png', 'public/logo512.png', 'src/logo.svg', 'src/assets/logo.svg'],
	nextjs: ['app/icon.png', 'app/icon.jpg', 'app/icon.svg', 'public/icon.png', 'public/apple-touch-icon.png'],
	vue: ['public/favicon.ico', 'public/favicon.svg', 'src/assets/logo.svg'],
	angular: ['src/favicon.ico', 'src/assets/icons/icon-192x192.png'],
	svelte: ['static/favicon.png', 'src/lib/assets/icon.png'],
	expo: ['assets/icon.png', 'assets/adaptive-icon.png', 'assets/splash-icon.png'],
	flutter: [
		'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
		'ios/Runner/Assets.xcassets/AppIcon.appiconset'
	],
	electron: ['build/icon.png', 'build/icon.ico', 'assets/icon.png', 'resources/icon.png'],
	ios: ['ios/Runner/Assets.xcassets/AppIcon.appiconset', 'ios/Runner/Images.xcassets/AppIcon.appiconset'],
	android: ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'],
	website: ['favicon.ico', 'favicon.png', 'public/favicon.ico', 'public/apple-touch-icon.png'],
	web: ['favicon.ico', 'favicon.png', 'public/favicon.ico', 'public/apple-touch-icon.png']
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
		void openStartPage(context);
	}
}

export function deactivate() {}

function shouldOpenOnStartup(): boolean {
	const config = vscode.workspace.getConfiguration(configSection);
	const workbenchConfig = vscode.workspace.getConfiguration('workbench');
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

	return config.get<boolean>(openOnStartupSetting, true)
		&& workbenchConfig.get<string>('startupEditor') === 'none'
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
				iconPath: await resolveProjectIconPath(vscode.Uri.file(project.path), project.name)
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
		const folderName = escapeHtml(project.path.split(/[\\/]/).pop() ?? project.name);
		const iconSource = project.iconPath
			? project.iconPath.startsWith('data:')
				? project.iconPath
				: webview.asWebviewUri(vscode.Uri.file(project.iconPath)).toString()
			: '';
		const projectVisual = project.iconPath
			? `<img class="project-icon" src="${escapeHtml(iconSource)}" alt="" loading="lazy">`
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
					--bg: #f3f5f9;
					--bg-deep: #e8edf5;
					--surface: #ffffff;
					--surface-soft: #f7f9fd;
					--surface-border: #d6dfed;
					--text: #111827;
					--muted: #5b6475;
					--accent: #0f766e;
					--accent-strong: #0b5f59;
					--accent-soft: rgba(15, 118, 110, 0.12);
					--shadow: 0 14px 40px rgba(12, 20, 36, 0.08);
					--error: #b42318;
				}

				@media (prefers-color-scheme: dark) {
					:root {
						--bg: #0d1320;
						--bg-deep: #121b2c;
						--surface: #131f33;
						--surface-soft: #1a2942;
						--surface-border: #2b3a54;
						--text: #eef4ff;
						--muted: #a8b6cf;
						--accent: #4fd1c5;
						--accent-strong: #73e0d6;
						--accent-soft: rgba(79, 209, 197, 0.14);
						--shadow: 0 18px 48px rgba(1, 8, 20, 0.55);
						--error: #ff9b8f;
					}
				}

				* {
					box-sizing: border-box;
				}

				body {
					margin: 0;
					min-height: 100vh;
					padding: 28px;
					font-family: 'Avenir Next', 'Segoe UI Variable', 'IBM Plex Sans', 'Noto Sans', sans-serif;
					background:
						radial-gradient(circle at 100% -10%, rgba(15, 118, 110, 0.12), transparent 40%),
						linear-gradient(160deg, var(--bg), var(--bg-deep));
					color: var(--text);
				}

				main {
					max-width: 1024px;
					margin: 0 auto;
					padding: 28px;
					border: 1px solid var(--surface-border);
					border-radius: 18px;
					background: var(--surface);
					box-shadow: var(--shadow);
				}

				header {
					display: flex;
					justify-content: space-between;
					gap: 16px;
					align-items: start;
					margin-bottom: 20px;
				}

				.kicker {
					display: inline-flex;
					align-items: center;
					padding: 4px 10px;
					margin-bottom: 10px;
					border-radius: 999px;
					background: var(--accent-soft);
					color: var(--accent);
					font-size: 0.72rem;
					font-weight: 800;
					letter-spacing: 0.06em;
					text-transform: uppercase;
				}

				h1 {
					margin: 0;
					font-size: clamp(1.8rem, 3vw, 2.3rem);
					line-height: 1.12;
					font-weight: 760;
				}

				.hero-meta {
					display: flex;
					align-items: center;
				}

				.project-count {
					display: inline-flex;
					align-items: baseline;
					gap: 6px;
					padding: 10px 12px;
					border-radius: 12px;
					background: var(--surface-soft);
					border: 1px solid var(--surface-border);
				}

				.project-count strong {
					font-size: clamp(1.2rem, 2vw, 1.5rem);
					line-height: 1;
				}

				.project-count span {
					color: var(--muted);
					font-size: 0.82rem;
				}

				.toolbar {
					display: flex;
					flex-wrap: wrap;
					gap: 12px;
					align-items: center;
					justify-content: space-between;
					margin-top: 20px;
					padding-top: 16px;
					border-top: 1px solid var(--surface-border);
				}

				.toolbar button,
				.project-card {
					border: 0;
					cursor: pointer;
				}

				.toolbar button {
					padding: 10px 14px;
					border-radius: 10px;
					font: inherit;
					font-weight: 650;
					background: var(--accent);
					color: #fff;
					transition: transform 120ms ease, background 120ms ease;
				}

				.toolbar button.secondary {
					background: var(--surface-soft);
					color: var(--text);
					border: 1px solid var(--surface-border);
				}

				.toolbar button:hover,
				.toolbar button:focus-visible,
				.project-card:hover,
				.project-card:focus-visible {
					transform: translateY(-1px);
				}

				.toolbar button:hover,
				.toolbar button:focus-visible {
					background: var(--accent-strong);
				}

				.root-banner {
					flex: 1 1 320px;
					padding: 12px 14px;
					border-radius: 12px;
					background: var(--surface-soft);
					border: 1px solid var(--surface-border);
				}

				.toolbar-actions {
					display: flex;
					flex-wrap: wrap;
					gap: 12px;
				}

				.root-label {
					display: block;
					margin-bottom: 4px;
					font-size: 0.72rem;
					letter-spacing: 0.08em;
					text-transform: uppercase;
					color: var(--muted);
				}

				.root-path {
					font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
					font-size: 0.88rem;
					word-break: break-all;
				}

				.project-list {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
					gap: 12px;
				}

				.project-search {
					margin-bottom: 12px;
				}

				.project-search input {
					width: 100%;
					padding: 10px 12px;
					border-radius: 10px;
					border: 1px solid var(--surface-border);
					background: var(--surface-soft);
					color: var(--text);
					font: inherit;
				}

				.project-search input::placeholder {
					color: var(--muted);
				}

				.project-card {
					display: flex;
					flex-direction: column;
					align-items: flex-start;
					gap: 8px;
					padding: 14px;
					border-radius: 14px;
					background: var(--surface-soft);
					border: 1px solid var(--surface-border);
					text-align: left;
					color: var(--text);
					min-height: 100px;
					justify-content: space-between;
					transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
					animation: card-in 180ms ease both;
				}

				.project-card[hidden] {
					display: none;
				}

				.project-card:hover,
				.project-card:focus-visible {
					border-color: rgba(15, 118, 110, 0.45);
					background: var(--surface);
					box-shadow: 0 6px 16px rgba(15, 30, 55, 0.12);
				}

				.project-mark {
					display: inline-grid;
					place-items: center;
					width: 38px;
					height: 38px;
					border-radius: 10px;
					background: var(--accent-soft);
					color: var(--accent);
					font-size: 0.96rem;
					font-weight: 800;
					text-transform: uppercase;
				}

				.project-icon {
					width: 38px;
					height: 38px;
					border-radius: 10px;
					object-fit: cover;
					background: rgba(255, 255, 255, 0.3);
					border: 1px solid rgba(17, 24, 39, 0.08);
				}

				.project-name {
					font-size: 1.02rem;
					font-weight: 700;
					line-height: 1.2;
				}

				.project-path {
					font-size: 0.84rem;
					color: var(--muted);
					max-width: 100%;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}

				.project-open {
					font-size: 0.8rem;
					font-weight: 700;
					letter-spacing: 0.03em;
					text-transform: uppercase;
					color: var(--accent);
				}

				.status {
					padding: 16px;
					border-radius: 12px;
					border: 1px dashed var(--surface-border);
					background: var(--surface-soft);
					font-size: 0.96rem;
					line-height: 1.5;
					color: var(--muted);
				}

				.status-error {
					color: var(--error);
				}

				@keyframes card-in {
					from {
						opacity: 0;
						transform: translateY(6px);
					}

					to {
						opacity: 1;
						transform: translateY(0);
					}
				}

				@media (max-width: 640px) {
					body {
						padding: 12px;
					}

					main {
						padding: 16px;
						border-radius: 14px;
					}

					header {
						flex-direction: column;
						align-items: flex-start;
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
						<h1>Simple Start</h1>
					</div>
					<div class="hero-meta">
						<div class="project-count">
							<strong>${projectCount}</strong>
							<span>${projectCount === 1 ? 'project' : 'projects'}</span>
						</div>
					</div>
				</header>
				${projectCount > 0 ? `
					<div class="project-search">
						<input id="project-search" type="search" placeholder="Filter projects by name">
					</div>
				` : ''}
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

				const searchElement = document.getElementById('project-search');
				if (searchElement) {
					searchElement.addEventListener('input', () => {
						const query = searchElement.value.trim().toLowerCase();
						document.querySelectorAll('.project-card').forEach((element) => {
							const text = (element.textContent ?? '').toLowerCase();
							element.hidden = query.length > 0 && !text.includes(query);
						});
					});
				}
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

async function resolveProjectIconPath(projectUri: vscode.Uri, projectName: string): Promise<string | undefined> {
	if (projectIconCache.has(projectUri.fsPath)) {
		return projectIconCache.get(projectUri.fsPath) ?? undefined;
	}

	const iconPath = await findProjectIconPath(projectUri, projectName);
	projectIconCache.set(projectUri.fsPath, iconPath ?? null);
	return iconPath;
}


async function findProjectIconPath(projectUri: vscode.Uri, projectName: string): Promise<string | undefined> {
	const projectType = await detectProjectType(projectUri);

	const appCatalogIconPath = await findMappedApplicationIconPath(projectUri, projectName);
	if (appCatalogIconPath) {
		return appCatalogIconPath;
	}

	const iosIconPath = await findIosProjectIconPath(projectUri);
	if (iosIconPath) {
		return iosIconPath;
	}

	const androidIconPath = await findAndroidProjectIconPath(projectUri);
	if (androidIconPath) {
		return androidIconPath;
	}

	const macosIconPath = await findMacosProjectIconPath(projectUri);
	if (macosIconPath) {
		return macosIconPath;
	}

	const electronIconPath = await findElectronProjectIconPath(projectUri);
	if (electronIconPath) {
		return electronIconPath;
	}

	const packageJsonIconPath = await findPackageJsonIconPath(projectUri);
	if (packageJsonIconPath) {
		return packageJsonIconPath;
	}

	const appIconSetPath = await findGenericAppIconSetPath(projectUri);
	if (appIconSetPath) {
		return appIconSetPath;
	}

	const websiteIconPath = await findBestWebsiteIconPath(projectUri);
	if (websiteIconPath) {
		return websiteIconPath;
	}

	const fallbackIconPath = await findFallbackHiResIconPath(projectUri);
	if (fallbackIconPath) {
		return fallbackIconPath;
	}

	return createTypeIconDataUri(projectName, projectType);
}

async function detectProjectType(projectUri: vscode.Uri): Promise<ProjectType> {
	if (await isFile(vscode.Uri.joinPath(projectUri, 'pubspec.yaml'))) {
		return 'flutter';
	}

	if (
		await isFile(vscode.Uri.joinPath(projectUri, 'next.config.js'))
		|| await isFile(vscode.Uri.joinPath(projectUri, 'next.config.mjs'))
		|| await isFile(vscode.Uri.joinPath(projectUri, 'next.config.ts'))
	) {
		return 'nextjs';
	}

	if (
		await isFile(vscode.Uri.joinPath(projectUri, 'electron-builder.yml'))
		|| await isFile(vscode.Uri.joinPath(projectUri, 'electron.vite.config.ts'))
		|| await isFile(vscode.Uri.joinPath(projectUri, 'electron.vite.config.js'))
	) {
		return 'electron';
	}

	if (await isDirectory(vscode.Uri.joinPath(projectUri, 'ios')) || await hasXcodeProject(projectUri)) {
		return 'apple';
	}

	if (await isDirectory(vscode.Uri.joinPath(projectUri, 'android'))) {
		return 'android';
	}

	if (await isFile(vscode.Uri.joinPath(projectUri, 'requirements.txt')) || await isFile(vscode.Uri.joinPath(projectUri, 'pyproject.toml'))) {
		return 'python';
	}

	if (await isFile(vscode.Uri.joinPath(projectUri, 'package.json'))) {
		if (/api|server|backend/i.test(projectUri.fsPath)) {
			return 'api';
		}

		return 'node';
	}

	if (/api|server|backend/i.test(projectUri.fsPath)) {
		return 'api';
	}

	if (/site|web|com/i.test(projectUri.fsPath)) {
		return 'web';
	}

	return 'generic';
}

async function hasXcodeProject(projectUri: vscode.Uri): Promise<boolean> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(projectUri);
		return entries.some(([name, fileType]) => fileType === vscode.FileType.Directory && name.endsWith('.xcodeproj'));
	} catch {
		return false;
	}
}

function createTypeIconDataUri(projectName: string, projectType: ProjectType): string {
	const initials = getProjectInitial(projectName).toUpperCase();
	const labels: Record<ProjectType, string> = {
		nextjs: 'NX',
		electron: 'EL',
		flutter: 'FL',
		apple: 'AP',
		android: 'AN',
		node: 'ND',
		python: 'PY',
		api: 'API',
		web: 'WEB',
		generic: initials
	};

	const palettes: Record<ProjectType, { bg: string; fg: string }> = {
		nextjs: { bg: '#111827', fg: '#f9fafb' },
		electron: { bg: '#0f172a', fg: '#67e8f9' },
		flutter: { bg: '#0c4a6e', fg: '#7dd3fc' },
		apple: { bg: '#334155', fg: '#f8fafc' },
		android: { bg: '#14532d', fg: '#bbf7d0' },
		node: { bg: '#1f2937', fg: '#86efac' },
		python: { bg: '#1e3a8a', fg: '#bfdbfe' },
		api: { bg: '#7c2d12', fg: '#fed7aa' },
		web: { bg: '#164e63', fg: '#a5f3fc' },
		generic: { bg: '#374151', fg: '#e5e7eb' }
	};

	const label = labels[projectType] ?? initials;
	const palette = palettes[projectType] ?? palettes.generic;
	const safeLabel = escapeHtml(label);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="${palette.bg}"/><text x="128" y="148" text-anchor="middle" fill="${palette.fg}" font-family="Avenir Next, Segoe UI, sans-serif" font-size="72" font-weight="700">${safeLabel}</text></svg>`;

	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function findMappedApplicationIconPath(projectUri: vscode.Uri, projectName: string): Promise<string | undefined> {
	const candidatePaths = getApplicationIconCandidates(projectName);

	for (const relativePath of candidatePaths) {
		const iconUri = await resolveIconCandidate(projectUri, relativePath);
		if (iconUri) {
			return iconUri.fsPath;
		}
	}

	return undefined;
}

function getApplicationIconCandidates(projectName: string): string[] {
	const normalizedProjectName = normalizeAppKey(projectName);
	const configuredMap = getApplicationIconMap();
	const candidates: string[] = [];

	for (const [appKey, paths] of Object.entries(configuredMap)) {
		const normalizedAppKey = normalizeAppKey(appKey);
		if (!normalizedAppKey) {
			continue;
		}

		const isMatch = normalizedProjectName === normalizedAppKey
			|| normalizedProjectName.includes(normalizedAppKey)
			|| normalizedAppKey.includes(normalizedProjectName);

		if (isMatch) {
			candidates.push(...paths);
		}
	}

	return [...new Set(candidates)];
}

function getApplicationIconMap(): ApplicationIconMap {
	const configuredValue = vscode.workspace.getConfiguration(configSection).get<unknown>(applicationIconMapSetting, {});
	const mergedMap: ApplicationIconMap = { ...defaultApplicationIconMap };

	if (!configuredValue || typeof configuredValue !== 'object' || Array.isArray(configuredValue)) {
		return mergedMap;
	}

	for (const [key, value] of Object.entries(configuredValue as Record<string, unknown>)) {
		if (typeof key !== 'string') {
			continue;
		}

		if (!Array.isArray(value)) {
			continue;
		}

		const paths = value
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);

		if (paths.length > 0) {
			mergedMap[key] = [...new Set(paths)];
		}
	}

	return mergedMap;
}

function normalizeAppKey(value: string): string {
	return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '');
}

async function findAndroidProjectIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	for (const relativePath of getAndroidIconCandidates()) {
		const iconUri = await resolveIconCandidate(projectUri, relativePath);
		if (iconUri) {
			return iconUri.fsPath;
		}
	}

	return undefined;
}

async function findMacosProjectIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	for (const relativePath of getMacosIconCandidates()) {
		const iconUri = await resolveIconCandidate(projectUri, relativePath);
		if (iconUri) {
			return iconUri.fsPath;
		}
	}

	return undefined;
}

async function findElectronProjectIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	for (const relativePath of getElectronIconCandidates()) {
		const iconUri = await resolveIconCandidate(projectUri, relativePath);
		if (iconUri) {
			return iconUri.fsPath;
		}
	}

	return undefined;
}

async function findPackageJsonIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	const packageJsonUri = vscode.Uri.joinPath(projectUri, 'package.json');
	if (!await isFile(packageJsonUri)) {
		return undefined;
	}

	try {
		const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonUri);
		const parsed = JSON.parse(new TextDecoder().decode(packageJsonContent)) as { icon?: string };
		if (typeof parsed.icon !== 'string' || parsed.icon.trim().length === 0) {
			return undefined;
		}

		const iconUri = await resolveIconCandidate(projectUri, parsed.icon);
		return iconUri?.fsPath;
	} catch {
		return undefined;
	}
}

async function resolveIconCandidate(projectUri: vscode.Uri, candidatePath: string): Promise<vscode.Uri | undefined> {
	const normalizedPath = candidatePath.trim();
	if (!normalizedPath) {
		return undefined;
	}

	const candidateUri = vscode.Uri.joinPath(projectUri, ...normalizedPath.split('/'));
	if (normalizedPath.toLowerCase().endsWith('.appiconset')) {
		if (!await isDirectory(candidateUri)) {
			return undefined;
		}

		return selectBestIconFromSet(candidateUri);
	}

	return await isFile(candidateUri) ? candidateUri : undefined;
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
		'apple-touch-icon-1024x1024.png',
		'apple-touch-icon-512x512.png',
		'favicon@2x.png',
		'favicon@3x.png',
		'favicon-512x512.png',
		'favicon-192x192.png',
		'favicon.svg',
		'favicon.png',
		'favicon-32x32.png',
		'favicon-16x16.png',
		'favicon.ico',
		'apple-touch-icon-180x180.png',
		'apple-touch-icon.png',
		'public/apple-touch-icon-1024x1024.png',
		'public/apple-touch-icon-512x512.png',
		'public/android-chrome-512x512.png',
		'public/android-chrome-192x192.png',
		'public/icon-512x512.png',
		'public/icon-192x192.png',
		'public/favicon.ico',
		'public/favicon.png',
		'public/favicon.svg',
		'public/favicon-32x32.png',
		'public/favicon-16x16.png',
		'public/favicon-512x512.png',
		'public/favicon-192x192.png',
		'public/apple-touch-icon-180x180.png',
		'public/apple-touch-icon.png',
		'public/icon.png',
		'public/icon-512.png',
		'public/icon-192.png',
		'public/icon.svg',
		'assets/apple-touch-icon-1024x1024.png',
		'assets/apple-touch-icon-512x512.png',
		'assets/android-chrome-512x512.png',
		'assets/android-chrome-192x192.png',
		'assets/icon-512x512.png',
		'assets/icon-192x192.png',
		'src/favicon.ico',
		'src/favicon.png',
		'src/favicon.svg',
		'src/assets/icon.png',
		'src/assets/icon-512.png',
		'src/assets/icon-192.png',
		'src/assets/icon.svg',
		'app/favicon.ico',
		'app/favicon.png',
		'app/favicon.svg',
		'app/icon.png',
		'app/icon.svg',
		'app/icon.jpg',
		'app/icon-512.png',
		'app/icon-192.png',
		'assets/icon.png',
		'assets/AppIcon.png',
		'assets/favicon.ico',
		'assets/favicon.png',
		'assets/favicon-32x32.png',
		'assets/favicon-16x16.png',
		'assets/apple-touch-icon.png',
		'assets/icon.svg',
		'dist/assets/AppIcon.png',
		'static/favicon.png'
	];
}

async function findBestWebsiteIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	const matches: vscode.Uri[] = [];

	for (const relativePath of getWebsiteIconCandidates()) {
		const iconUri = await resolveIconCandidate(projectUri, relativePath);
		if (iconUri) {
			matches.push(iconUri);
		}
	}

	if (matches.length === 0) {
		return undefined;
	}

	matches.sort((left, right) => scoreWebsiteIconUri(right) - scoreWebsiteIconUri(left));
	return matches[0].fsPath;
}

function scoreWebsiteIconUri(iconUri: vscode.Uri): number {
	const lowerPath = iconUri.fsPath.toLowerCase();
	const filename = lowerPath.split(/[\\/]/).pop() ?? '';
	let score = scoreIconUri(iconUri);

	if (filename.includes('apple-touch-icon')) {
		score += 900;
	}

	if (filename.includes('android-chrome')) {
		score += 820;
	}

	if (filename.includes('maskable') || filename.includes('mstile')) {
		score += 700;
	}

	if (filename === 'favicon.ico') {
		score -= 1000;
	}

	if (filename.includes('favicon-16x16') || filename.includes('favicon-32x32')) {
		score -= 650;
	}

	if (filename.includes('favicon') && !filename.includes('192') && !filename.includes('512') && !filename.includes('@2x') && !filename.includes('@3x')) {
		score -= 280;
	}

	const dimensions = extractDimensionScore(filename);
	score += dimensions;

	return score;
}

function extractDimensionScore(filename: string): number {
	const matches = [...filename.matchAll(/(\d{2,4})x(\d{2,4})/g)];
	if (matches.length === 0) {
		return 0;
	}

	const maxDimension = Math.max(...matches.map((match) => Math.max(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10))));
	return maxDimension;
}

async function findGenericAppIconSetPath(projectUri: vscode.Uri): Promise<string | undefined> {
	const iconSetDirectories = await collectMatchingDirectories(projectUri, {
		maxDepth: 5,
		shouldInclude: (name) => /appicon.*\.appiconset$/i.test(name) || name.toLowerCase() === 'appicon.appiconset'
	});

	for (const iconSetUri of iconSetDirectories.sort((left, right) => scoreIconSetUri(right) - scoreIconSetUri(left))) {
		const iconUri = await selectBestIconFromSet(iconSetUri);
		if (iconUri) {
			return iconUri.fsPath;
		}
	}

	return undefined;
}

async function findFallbackHiResIconPath(projectUri: vscode.Uri): Promise<string | undefined> {
	const candidateFiles = await collectMatchingFiles(projectUri, {
		maxDepth: 4,
		extensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'],
		namePattern: /(appicon|icon|favicon|logo|launchicon)/i
	});

	if (candidateFiles.length === 0) {
		return undefined;
	}

	candidateFiles.sort((left, right) => scoreIconUri(right) - scoreIconUri(left));
	return candidateFiles[0].fsPath;
}

type CollectDirectoryOptions = {
	maxDepth: number;
	shouldInclude: (name: string) => boolean;
};

type CollectFileOptions = {
	maxDepth: number;
	extensions: string[];
	namePattern: RegExp;
};

async function collectMatchingDirectories(rootUri: vscode.Uri, options: CollectDirectoryOptions): Promise<vscode.Uri[]> {
	const matches: vscode.Uri[] = [];
	await walkDirectoryTree(rootUri, options.maxDepth, async (entryUri, entryName, fileType) => {
		if (fileType === vscode.FileType.Directory && options.shouldInclude(entryName)) {
			matches.push(entryUri);
		}
	});
	return matches;
}

async function collectMatchingFiles(rootUri: vscode.Uri, options: CollectFileOptions): Promise<vscode.Uri[]> {
	const matches: vscode.Uri[] = [];
	const extensions = new Set(options.extensions.map((extension) => extension.toLowerCase()));

	await walkDirectoryTree(rootUri, options.maxDepth, async (entryUri, entryName, fileType) => {
		if (fileType !== vscode.FileType.File) {
			return;
		}

		const lowerName = entryName.toLowerCase();
		const extension = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';
		if (!extensions.has(extension)) {
			return;
		}

		if (!options.namePattern.test(entryName)) {
			return;
		}

		matches.push(entryUri);
	});

	return matches;
}

async function walkDirectoryTree(
	directoryUri: vscode.Uri,
	maxDepth: number,
	onEntry: (entryUri: vscode.Uri, entryName: string, fileType: vscode.FileType) => Promise<void>
): Promise<void> {
	const skipDirectoryNames = new Set([
		'node_modules',
		'.git',
		'.next',
		'.nuxt',
		'.idea',
		'.vscode',
		'coverage',
		'.turbo'
	]);

	const walk = async (currentUri: vscode.Uri, depth: number): Promise<void> => {
		if (depth > maxDepth) {
			return;
		}

		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(currentUri);
		} catch {
			return;
		}

		for (const [entryName, entryType] of entries) {
			if (entryType === vscode.FileType.Directory && skipDirectoryNames.has(entryName)) {
				continue;
			}

			const entryUri = vscode.Uri.joinPath(currentUri, entryName);
			await onEntry(entryUri, entryName, entryType);

			if (entryType === vscode.FileType.Directory) {
				await walk(entryUri, depth + 1);
			}
		}
	};

	await walk(directoryUri, 0);
}

function scoreIconSetUri(iconSetUri: vscode.Uri): number {
	const value = iconSetUri.fsPath.toLowerCase();
	let score = 0;

	if (value.includes('/assets.xcassets/')) {
		score += 140;
	}

	if (value.includes('/appicon.appiconset')) {
		score += 180;
	}

	if (value.includes('/ios/')) {
		score += 90;
	}

	if (value.includes('/macos/')) {
		score += 70;
	}

	if (value.includes('/runner/')) {
		score += 50;
	}

	if (value.includes('/dist/') || value.includes('/build/')) {
		score -= 25;
	}

	return score;
}

function scoreIconUri(iconUri: vscode.Uri): number {
	const path = iconUri.fsPath;
	const lowerPath = path.toLowerCase();
	const filename = path.split(/[\\/]/).pop() ?? '';
	let score = scoreIconName(filename);

	if (lowerPath.includes('/assets.xcassets/')) {
		score += 180;
	}

	if (lowerPath.includes('/public/')) {
		score += 70;
	}

	if (lowerPath.includes('/assets/')) {
		score += 55;
	}

	if (lowerPath.includes('/src/')) {
		score += 45;
	}

	if (lowerPath.includes('/dist/')) {
		score -= 20;
	}

	if (lowerPath.includes('/build/')) {
		score -= 10;
	}

	return score;
}

function getAndroidIconCandidates(): string[] {
	return [
		'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
		'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
		'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png',
		'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
		'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
		'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
		'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
		'android/app/src/main/res/drawable/ic_launcher_foreground.png',
		'android/app/src/main/res/drawable/ic_launcher_background.png',
		'android/app/src/main/ic_launcher-web.png'
	];
}

function getMacosIconCandidates(): string[] {
	return [
		'macos/Runner/Assets.xcassets/AppIcon.appiconset',
		'macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_1024.png',
		'macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_512.png'
	];
}

function getElectronIconCandidates(): string[] {
	return [
		'build/icon.png',
		'build/icon.ico',
		'build/icons/512x512.png',
		'assets/icon.png',
		'assets/icon.ico',
		'resources/icon.png',
		'icon.png',
		'icon.ico'
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
			.filter(([name, fileType]) => fileType === vscode.FileType.File && /\.(png|jpg|jpeg|webp|svg)$/i.test(name))
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
	const normalizedFilename = filename.toLowerCase();
	const numericMatches = [...normalizedFilename.matchAll(/(\d+)/g)].map((match) => Number.parseInt(match[1], 10));
	const numericScore = numericMatches.length > 0 ? Math.max(...numericMatches) : 0;
	const pngBonus = normalizedFilename.endsWith('.png') ? 500 : 0;
	const svgBonus = normalizedFilename.endsWith('.svg') ? 300 : 0;
	const appIconBonus = /appicon|icon/i.test(normalizedFilename) ? 100 : 0;
	const faviconIcoPenalty = normalizedFilename === 'favicon.ico' ? -1000 : 0;
	const tinyFaviconPenalty = /favicon-?(16x16|32x32)/.test(normalizedFilename) ? -500 : 0;
	const appleTouchBonus = normalizedFilename.includes('apple-touch-icon') ? 700 : 0;
	const chromeBonus = normalizedFilename.includes('android-chrome') ? 650 : 0;
	const highResBonus = extractDimensionScore(normalizedFilename);

	return pngBonus + svgBonus + appIconBonus + numericScore + faviconIcoPenalty + tinyFaviconPenalty + appleTouchBonus + chromeBonus + highResBonus;
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
