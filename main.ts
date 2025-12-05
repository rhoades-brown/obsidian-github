import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Menu } from 'obsidian';
import { GitHubService, type GitHubRepo } from './src/services/githubService';
import { SyncService, PersistedSyncState, SyncResult } from './src/services/syncService';
import { LoggerService, LoggerConfig, LogLevel, DEFAULT_LOGGER_CONFIG } from './src/services/loggerService';
import { DiffView, DIFF_VIEW_TYPE } from './src/views/DiffView';
import { SyncView, SYNC_VIEW_TYPE } from './src/views/SyncView';

// GitHub Octokit Plugin - Sync your Obsidian vault with GitHub

// ============================================================================
// Type Definitions
// ============================================================================

/** File change status */
type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'unchanged' | 'conflict';

/** Sync operation type */
type SyncOperation = 'pull' | 'push' | 'sync';

/** Conflict resolution strategy */
type ConflictResolution = 'keep-local' | 'keep-remote' | 'keep-both' | 'manual';

/** Current sync state */
type SyncState = 'idle' | 'syncing' | 'error' | 'conflict';

// ============================================================================
// Interfaces
// ============================================================================

/** Repository information */
interface RepoInfo {
	owner: string;
	name: string;
	branch: string;
	defaultBranch: string;
	isPrivate: boolean;
	url: string;
}

/** GitHub authentication configuration */
interface AuthConfig {
	token: string;
	tokenValidated: boolean;
	username: string;
}

/** Sync schedule configuration - individual toggles for each trigger */
interface SyncScheduleConfig {
	syncOnSave: boolean;
	syncOnInterval: boolean;
	syncOnStartup: boolean;
	intervalMinutes: number;
}

/** Commit message template configuration */
interface CommitConfig {
	messageTemplate: string;
	includeTimestamp: boolean;
	includeFileCount: boolean;
}

/** Main plugin settings */
interface GitHubOctokitSettings {
	// Authentication
	auth: AuthConfig;

	// Repository
	repo: RepoInfo | null;
	subfolderPath: string;

	// Sync configuration
	syncSchedule: SyncScheduleConfig;
	commitConfig: CommitConfig;

	// Conflict handling
	defaultConflictResolution: ConflictResolution;

	// Ignore patterns
	ignorePatterns: string[];

	// UI preferences
	showStatusBar: boolean;
	showNotifications: boolean;

	// Logging
	logging: LoggerConfig;
}

/** Represents a file's state for sync comparison */
interface FileState {
	path: string;
	localHash: string | null;
	remoteHash: string | null;
	remoteSha: string | null;
	localModified: number | null;
	remoteModified: number | null;
	status: FileChangeStatus;
	size: number;
	isBinary: boolean;
}

/** Information about a sync conflict */
interface ConflictInfo {
	path: string;
	localContent: string;
	remoteContent: string;
	baseContent: string | null;
	localModified: number;
	remoteModified: number;
	resolution: ConflictResolution | null;
}

/** Current sync status */
interface SyncStatus {
	state: SyncState;
	lastSyncTime: number | null;
	lastSyncCommitSha: string | null;
	pendingChanges: {
		toPush: number;
		toPull: number;
		conflicts: number;
	};
	currentOperation: SyncOperation | null;
	progress: {
		current: number;
		total: number;
		currentFile: string | null;
	} | null;
	error: string | null;
}

/** Stored sync state for persistence */
interface SyncStateData {
	lastSyncTime: number;
	lastSyncCommitSha: string;
	fileHashes: Record<string, string>;
	fileShas: Record<string, string>;
}

/** Commit information from GitHub */
interface CommitInfo {
	sha: string;
	message: string;
	author: string;
	timestamp: number;
	filesChanged: number;
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: GitHubOctokitSettings = {
	auth: {
		token: '',
		tokenValidated: false,
		username: '',
	},
	repo: null,
	subfolderPath: '',
	syncSchedule: {
		syncOnSave: false,
		syncOnInterval: false,
		syncOnStartup: false,
		intervalMinutes: 30,
	},
	commitConfig: {
		messageTemplate: 'Vault sync: {date}',
		includeTimestamp: true,
		includeFileCount: true,
	},
	defaultConflictResolution: 'manual',
	ignorePatterns: [
		'.obsidian/workspace.json',
		'.obsidian/workspace-mobile.json',
		'.obsidian/github-sync-metadata.json',
		'.git/**',
		'.gitignore',
	],
	showStatusBar: true,
	showNotifications: true,
	logging: {
		enabled: true,
		level: 'info',
		persistToFile: false,
		logFilePath: '.github-sync.log',
		maxEntries: 1000,
	},
}

export default class GitHubOctokitPlugin extends Plugin {
	settings: GitHubOctokitSettings;
	githubService: GitHubService;
	syncService: SyncService;
	logger: LoggerService;
	private statusBarItem: HTMLElement | null = null;
	private syncState: PersistedSyncState | null = null;
	private syncIntervalId: number | null = null;
	private isSyncing = false;

	async onload() {
		await this.loadSettings();
		await this.loadSyncState();

		// Initialize logger
		this.logger = new LoggerService(this.settings.logging);
		this.logger.initialize(this.app);
		this.logger.info('Plugin', 'GitHub Octokit plugin loaded');

		// Initialize services
		this.githubService = new GitHubService();
		this.syncService = new SyncService(
			this.app,
			this.githubService,
			this.settings.ignorePatterns,
			this.settings.subfolderPath
		);

		// Register custom views
		this.registerView(DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf));
		this.registerView(SYNC_VIEW_TYPE, (leaf) => new SyncView(leaf, this));

		// Try to authenticate if we have a stored token
		if (this.settings.auth.token) {
			await this.validateAndConnect();
		}

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('github', 'GitHub Octokit - Click to sync, right-click for menu', async (evt: MouseEvent) => {
			if (evt.button === 0) {
				// Left click - trigger sync
				await this.performSync();
			}
		});
		ribbonIconEl.addClass('github-octokit-ribbon-class');

		// Right-click context menu
		ribbonIconEl.addEventListener('contextmenu', (evt: MouseEvent) => {
			evt.preventDefault();
			const menu = new (require('obsidian').Menu)();

			menu.addItem((item: any) => {
				item.setTitle('⟳ Sync Now')
					.setIcon('refresh-cw')
					.onClick(() => this.performSync());
			});

			menu.addItem((item: any) => {
				item.setTitle('⬇ Pull from GitHub')
					.setIcon('download')
					.onClick(() => this.performSync('pull'));
			});

			menu.addItem((item: any) => {
				item.setTitle('⬆ Push to GitHub')
					.setIcon('upload')
					.onClick(() => this.performSync('push'));
			});

			menu.addSeparator();

			menu.addItem((item: any) => {
				item.setTitle('Open Sync Panel')
					.setIcon('layout-sidebar-right')
					.onClick(() => this.openSyncView());
			});

			menu.addItem((item: any) => {
				item.setTitle('Settings')
					.setIcon('settings')
					.onClick(() => {
						(this.app as any).setting.open();
						(this.app as any).setting.openTabById('github-octokit');
					});
			});

			menu.showAtMouseEvent(evt);
		});

		// This adds a status bar item to the bottom of the app.
		if (this.settings.showStatusBar) {
			this.statusBarItem = this.addStatusBarItem();
			this.updateStatusBar();
			this.setupStatusBarClick();
		}

		// Command: Sync Now
		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: async () => {
				await this.performSync();
			}
		});

		// Command: Pull from GitHub
		this.addCommand({
			id: 'pull-from-github',
			name: 'Pull from GitHub',
			callback: async () => {
				await this.performSync('pull');
			}
		});

		// Command: Push to GitHub
		this.addCommand({
			id: 'push-to-github',
			name: 'Push to GitHub',
			callback: async () => {
				await this.performSync('push');
			}
		});

		// Command: Open sync modal
		this.addCommand({
			id: 'open-sync-modal',
			name: 'Open sync modal',
			callback: () => {
				new GitHubOctokitModal(this.app).open();
			}
		});

		// Command: Open diff view
		this.addCommand({
			id: 'open-diff-view',
			name: 'Open diff view',
			callback: async () => {
				await this.openDiffView();
			}
		});

		// Command: Open sync panel
		this.addCommand({
			id: 'open-sync-panel',
			name: 'Open sync panel',
			callback: async () => {
				await this.openSyncView();
			}
		});

		// Command: View conflicts
		this.addCommand({
			id: 'view-conflicts',
			name: 'View sync conflicts',
			callback: async () => {
				const view = await this.openSyncView();
				if (view) {
					new Notice('Conflicts are shown at the top of the sync panel');
				}
			}
		});

		// Command: Open settings
		this.addCommand({
			id: 'open-settings',
			name: 'Open GitHub settings',
			callback: () => {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById('github-octokit');
			}
		});

		// This adds a settings tab
		this.addSettingTab(new GitHubOctokitSettingTab(this.app, this));

		// Set up auto-sync triggers
		this.setupAutoSync();

		// Sync on startup if enabled
		if (this.settings.syncSchedule.syncOnStartup && this.githubService.isAuthenticated && this.settings.repo) {
			setTimeout(() => this.performSync(), 3000); // Delay to let Obsidian fully load
		}

		// First-run setup notice
		if (!this.settings.auth.token) {
			setTimeout(() => {
				new Notice(
					'GitHub Octokit: Welcome! Open Settings → GitHub Octokit to configure sync.',
					15000
				);
			}, 2000);
		}
	}

	onunload() {
		this.githubService.disconnect();
		if (this.syncIntervalId) {
			window.clearInterval(this.syncIntervalId);
		}
	}

	/**
	 * Validate the stored token and connect to GitHub
	 */
	async validateAndConnect(): Promise<boolean> {
		const success = await this.githubService.authenticate(this.settings.auth.token);

		if (success && this.githubService.user) {
			this.settings.auth.tokenValidated = true;
			this.settings.auth.username = this.githubService.user.login;
			await this.saveSettings();
			this.updateStatusBar();
			// Update sync service config
			this.syncService.configure(this.settings.ignorePatterns, this.settings.subfolderPath);
			return true;
		} else {
			this.settings.auth.tokenValidated = false;
			this.settings.auth.username = '';
			await this.saveSettings();
			this.updateStatusBar();
			return false;
		}
	}

	/**
	 * Update the status bar with current sync status
	 */
	updateStatusBar(): void {
		if (!this.statusBarItem) return;

		let text: string;
		let tooltip: string;

		if (this.isSyncing) {
			text = '⟳ Syncing...';
			tooltip = 'GitHub sync in progress';
		} else if (this.githubService.isAuthenticated) {
			const user = this.githubService.user?.login || 'Unknown';
			const repo = this.settings.repo?.name || 'No repo';
			const lastSync = this.syncState?.lastSyncTime
				? new Date(this.syncState.lastSyncTime).toLocaleTimeString()
				: 'Never';
			text = `⬡ ${repo}`;
			tooltip = `GitHub: ${user}/${repo}\nLast sync: ${lastSync}\nClick to open sync panel`;
		} else {
			text = '⬡ Not connected';
			tooltip = 'GitHub: Not connected\nClick to configure';
		}

		this.statusBarItem.setText(text);
		this.statusBarItem.setAttr('aria-label', tooltip);
	}

	/**
	 * Set up status bar click handler
	 */
	private setupStatusBarClick(): void {
		if (!this.statusBarItem) return;

		this.statusBarItem.addClass('mod-clickable');
		this.statusBarItem.addEventListener('click', async () => {
			if (this.githubService.isAuthenticated) {
				await this.openSyncView();
			} else {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById('github-octokit');
			}
		});
	}

	/**
	 * Set up auto-sync triggers based on settings
	 */
	setupAutoSync(): void {
		// Clear existing interval
		if (this.syncIntervalId) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}

		// Set up interval sync
		if (this.settings.syncSchedule.syncOnInterval) {
			const intervalMs = this.settings.syncSchedule.intervalMinutes * 60 * 1000;
			this.syncIntervalId = window.setInterval(() => {
				this.performSync();
			}, intervalMs);
		}

		// Set up on-save sync
		if (this.settings.syncSchedule.syncOnSave) {
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file instanceof TFile) {
						// Debounce: wait 2 seconds after last save
						this.debouncedSync();
					}
				})
			);
		}
	}

	private syncDebounceTimer: number | null = null;

	/**
	 * Debounced sync for on-save trigger
	 */
	private debouncedSync(): void {
		if (this.syncDebounceTimer) {
			window.clearTimeout(this.syncDebounceTimer);
		}
		this.syncDebounceTimer = window.setTimeout(() => {
			this.performSync();
			this.syncDebounceTimer = null;
		}, 2000);
	}

	/**
	 * Perform a sync operation
	 */
	async performSync(direction: 'pull' | 'push' | 'sync' = 'sync'): Promise<SyncResult | null> {
		if (this.isSyncing) {
			this.logger.debug('Sync', 'Sync already in progress, skipping');
			new Notice('Sync already in progress...');
			return null;
		}

		if (!this.githubService.isAuthenticated) {
			this.logger.warn('Sync', 'Not authenticated, cannot sync');
			new Notice('Not connected to GitHub. Configure in settings.');
			return null;
		}

		if (!this.settings.repo) {
			this.logger.warn('Sync', 'No repository selected');
			new Notice('No repository selected. Configure in settings.');
			return null;
		}

		this.isSyncing = true;
		this.updateStatusBar();
		this.logger.info('Sync', `Starting ${direction} operation`, { repo: `${this.settings.repo.owner}/${this.settings.repo.name}` });

		try {
			// Generate commit message
			const now = new Date();
			const commitMessage = this.settings.commitConfig.messageTemplate
				.replace('{date}', now.toISOString())
				.replace('{action}', direction);

			const { result, newState } = await this.syncService.sync(
				this.settings.repo.owner,
				this.settings.repo.name,
				this.settings.repo.branch,
				commitMessage,
				this.syncState || undefined,
				{ direction }
			);

			// Save new sync state
			this.syncState = newState;
			await this.saveSyncState();

			// Log result
			this.logger.info('Sync', `Sync ${result.success ? 'completed' : 'failed'}`, {
				filesProcessed: result.filesProcessed,
				filesPulled: result.filesPulled,
				filesPushed: result.filesPushed,
				conflicts: result.conflicts.length,
				errors: result.errors,
			});

			// Show result notification
			if (this.settings.showNotifications) {
				if (result.success) {
					if (result.filesProcessed > 0) {
						new Notice(`Sync complete: ${result.filesPulled} pulled, ${result.filesPushed} pushed`);
					} else {
						new Notice('Already up to date');
					}
				} else {
					new Notice(`Sync failed: ${result.errors.join(', ')}`);
				}

				if (result.conflicts.length > 0) {
					new Notice(`${result.conflicts.length} conflicts need resolution`);
				}
			}

			return result;
		} catch (error) {
			console.error('Sync error:', error);
			this.handleSyncError(error);
			return null;
		} finally {
			this.isSyncing = false;
			this.updateStatusBar();
		}
	}

	/**
	 * Handle sync errors with appropriate messages
	 */
	private async handleSyncError(error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		this.logger.error('Sync', 'Sync error occurred', { error: message });

		// Check for common error types
		if (message.includes('401') || message.includes('Bad credentials')) {
			this.logger.error('Auth', 'Authentication failed');
			new Notice('Authentication failed. Please check your GitHub token in settings.', 8000);
		} else if (message.includes('403') || message.includes('rate limit')) {
			this.logger.warn('API', 'Rate limit exceeded');
			try {
				const rateLimit = await this.githubService.getRateLimitStatus();
				const resetTime = rateLimit.reset
					? rateLimit.reset.toLocaleTimeString()
					: 'soon';
				new Notice(`GitHub rate limit exceeded. Resets at ${resetTime}`, 8000);
			} catch {
				new Notice('GitHub rate limit exceeded. Please wait before retrying.', 8000);
			}
		} else if (message.includes('404')) {
			this.logger.error('API', 'Repository or branch not found');
			new Notice('Repository or branch not found. Check your settings.', 8000);
		} else if (message.includes('network') || message.includes('fetch')) {
			new Notice('Network error. Check your internet connection.', 8000);
		} else if (message.includes('conflict')) {
			new Notice('Sync conflicts detected. Open the sync panel to resolve.', 8000);
		} else {
			new Notice(`Sync error: ${message}`, 5000);
		}
	}

	async loadSettings() {
		const data = await this.loadData() || {};
		// Extract syncState before merging with defaults
		const { syncState, ...settingsData } = data;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
	}

	async saveSettings() {
		// Preserve syncState when saving settings
		const data = await this.loadData() || {};
		await this.saveData({ ...this.settings, syncState: data.syncState });
	}

	async loadSyncState() {
		const data = await this.loadData();
		this.syncState = data?.syncState || null;
	}

	async saveSyncState() {
		// Preserve settings when saving syncState
		const data = await this.loadData() || {};
		data.syncState = this.syncState;
		await this.saveData(data);
	}

	/**
	 * Open the diff view in a new leaf
	 */
	async openDiffView(filename?: string, localContent?: string, remoteContent?: string): Promise<DiffView | null> {
		const leaf = this.app.workspace.getLeaf('split');
		await leaf.setViewState({
			type: DIFF_VIEW_TYPE,
			active: true,
		});

		const view = leaf.view;
		if (view instanceof DiffView) {
			if (filename && localContent !== undefined && remoteContent !== undefined) {
				view.setContent(filename, localContent, remoteContent);
			}
			return view;
		}
		return null;
	}

	/**
	 * Get the active diff view if one is open
	 */
	getDiffView(): DiffView | null {
		const leaves = this.app.workspace.getLeavesOfType(DIFF_VIEW_TYPE);
		if (leaves.length > 0) {
			const view = leaves[0].view;
			if (view instanceof DiffView) return view;
		}
		return null;
	}

	/**
	 * Open the sync view in the right sidebar
	 */
	async openSyncView(): Promise<SyncView | null> {
		const existing = this.app.workspace.getLeavesOfType(SYNC_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			const view = existing[0].view;
			if (view instanceof SyncView) {
				await view.refresh();
				return view;
			}
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;

		await leaf.setViewState({
			type: SYNC_VIEW_TYPE,
			active: true,
		});

		this.app.workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof SyncView) return view;
		return null;
	}

	/**
	 * Get the active sync view if one is open
	 */
	getSyncView(): SyncView | null {
		const leaves = this.app.workspace.getLeavesOfType(SYNC_VIEW_TYPE);
		if (leaves.length > 0) {
			const view = leaves[0].view;
			if (view instanceof SyncView) return view;
		}
		return null;
	}
}

class GitHubOctokitModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('GitHub Octokit Sync');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

/**
 * Modal for viewing logs
 */
class LogViewerModal extends Modal {
	private logger: LoggerService;

	constructor(app: App, logger: LoggerService) {
		super(app);
		this.logger = logger;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('github-octokit-log-viewer');

		contentEl.createEl('h2', { text: 'Sync Logs' });

		// Controls
		const controls = contentEl.createDiv({ cls: 'log-viewer-controls' });

		const levelSelect = controls.createEl('select');
		['all', 'debug', 'info', 'warn', 'error'].forEach(level => {
			const option = levelSelect.createEl('option', { text: level, value: level });
			if (level === 'all') option.selected = true;
		});

		const exportBtn = controls.createEl('button', { text: 'Export' });
		exportBtn.addEventListener('click', () => {
			const text = this.logger.exportAsText();
			navigator.clipboard.writeText(text);
			new Notice('Logs copied to clipboard');
		});

		// Log entries container
		const logsContainer = contentEl.createDiv({ cls: 'log-entries' });

		const renderLogs = (filter?: string) => {
			logsContainer.empty();
			const entries = this.logger.getRecentEntries(100);
			const filtered = filter && filter !== 'all'
				? entries.filter(e => e.level === filter)
				: entries;

			if (filtered.length === 0) {
				logsContainer.createDiv({ text: 'No log entries', cls: 'log-empty' });
				return;
			}

			filtered.reverse().forEach(entry => {
				const entryEl = logsContainer.createDiv({ cls: `log-entry log-${entry.level}` });
				const time = entry.timestamp.toLocaleTimeString();
				entryEl.createSpan({ text: `[${time}]`, cls: 'log-time' });
				entryEl.createSpan({ text: `[${entry.level.toUpperCase()}]`, cls: 'log-level' });
				entryEl.createSpan({ text: `[${entry.category}]`, cls: 'log-category' });
				entryEl.createSpan({ text: entry.message, cls: 'log-message' });
				if (entry.data) {
					entryEl.createEl('pre', {
						text: JSON.stringify(entry.data, null, 2),
						cls: 'log-data'
					});
				}
			});
		};

		levelSelect.addEventListener('change', () => renderLogs(levelSelect.value));
		renderLogs();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class GitHubOctokitSettingTab extends PluginSettingTab {
	plugin: GitHubOctokitPlugin;
	private repositories: GitHubRepo[] = [];

	constructor(app: App, plugin: GitHubOctokitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Authentication Section
		containerEl.createEl('h2', { text: 'GitHub Authentication' });

		// Connection status
		const statusEl = containerEl.createDiv({ cls: 'github-octokit-status' });
		this.updateConnectionStatus(statusEl);

		new Setting(containerEl)
			.setName('Personal Access Token')
			.setDesc('GitHub PAT with repo access. Create one at GitHub → Settings → Developer settings → Personal access tokens')
			.addText(text => {
				text
					.setPlaceholder('ghp_xxxxxxxxxxxx')
					.setValue(this.plugin.settings.auth.token)
					.onChange(async (value) => {
						this.plugin.settings.auth.token = value;
						this.plugin.settings.auth.tokenValidated = false;
						await this.plugin.saveSettings();
					});
				// Make the input a password field
				text.inputEl.type = 'password';
			})
			.addButton(button => button
				.setButtonText('Connect')
				.setCta()
				.onClick(async () => {
					button.setButtonText('Connecting...');
					button.setDisabled(true);

					const success = await this.plugin.validateAndConnect();

					if (success) {
						new Notice(`Connected to GitHub as ${this.plugin.githubService.user?.login}`);
						await this.loadRepositories();
					} else {
						new Notice('Failed to connect to GitHub. Check your token.');
					}

					// Refresh the settings display
					this.display();
				}));

		// Repository Section
		containerEl.createEl('h2', { text: 'Repository' });

		const repoSetting = new Setting(containerEl)
			.setName('Repository')
			.setDesc('Select a repository to sync with');

		if (this.plugin.settings.auth.tokenValidated) {
			repoSetting.addDropdown(async dropdown => {
				dropdown.addOption('', 'Select a repository...');

				// Load repositories if not already loaded
				if (this.repositories.length === 0) {
					await this.loadRepositories();
				}

				for (const repo of this.repositories) {
					dropdown.addOption(repo.fullName, repo.fullName);
				}

				dropdown.setValue(this.plugin.settings.repo
					? `${this.plugin.settings.repo.owner}/${this.plugin.settings.repo.name}`
					: '');

				dropdown.onChange(async (value) => {
					if (value) {
						const repo = this.repositories.find(r => r.fullName === value);
						if (repo) {
							this.plugin.settings.repo = {
								owner: repo.owner,
								name: repo.name,
								branch: repo.defaultBranch,
								defaultBranch: repo.defaultBranch,
								isPrivate: repo.isPrivate,
								url: repo.url,
							};
							await this.plugin.saveSettings();
							this.plugin.updateStatusBar();
							this.display(); // Refresh to show branch selector
						}
					} else {
						this.plugin.settings.repo = null;
						await this.plugin.saveSettings();
						this.plugin.updateStatusBar();
					}
				});
			});
		} else {
			repoSetting.addDropdown(dropdown => dropdown
				.addOption('', 'Connect to GitHub first...')
				.setDisabled(true));
		}

		// Branch selector (only if repo is selected)
		if (this.plugin.settings.repo) {
			new Setting(containerEl)
				.setName('Branch')
				.setDesc('Branch to sync with')
				.addText(text => text
					.setPlaceholder('main')
					.setValue(this.plugin.settings.repo?.branch ?? 'main')
					.onChange(async (value) => {
						if (this.plugin.settings.repo) {
							this.plugin.settings.repo.branch = value || 'main';
							await this.plugin.saveSettings();
						}
					}));
		}

		new Setting(containerEl)
			.setName('Subfolder Path')
			.setDesc('Optional: Sync vault to a subfolder in the repo (e.g., "notes/obsidian")')
			.addText(text => text
				.setPlaceholder('/')
				.setValue(this.plugin.settings.subfolderPath)
				.onChange(async (value) => {
					this.plugin.settings.subfolderPath = value;
					await this.plugin.saveSettings();
				}));

		// Ignore Patterns Section
		containerEl.createEl('h2', { text: 'Ignore Patterns' });
		containerEl.createEl('p', {
			text: 'Files matching these patterns will be excluded from sync. Use glob patterns (e.g., "*.tmp", ".obsidian/workspace.json").',
			cls: 'setting-item-description'
		});

		const patternsContainer = containerEl.createDiv({ cls: 'github-octokit-ignore-patterns' });

		// Display current patterns
		this.plugin.settings.ignorePatterns.forEach((pattern, index) => {
			new Setting(patternsContainer)
				.setName(pattern)
				.addButton(button => button
					.setIcon('trash')
					.setTooltip('Remove pattern')
					.onClick(async () => {
						this.plugin.settings.ignorePatterns.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.syncService.configure(
							this.plugin.settings.ignorePatterns,
							this.plugin.settings.subfolderPath
						);
						this.display();
					}));
		});

		// Add new pattern
		new Setting(containerEl)
			.setName('Add Pattern')
			.setDesc('Add a new ignore pattern')
			.addText(text => text
				.setPlaceholder('.obsidian/cache/**')
				.onChange(() => {})) // Keep text while typing
			.addButton(button => button
				.setButtonText('Add')
				.onClick(async () => {
					const input = containerEl.querySelector('.github-octokit-ignore-patterns + .setting-item input') as HTMLInputElement;
					const value = input?.value?.trim();
					if (value && !this.plugin.settings.ignorePatterns.includes(value)) {
						this.plugin.settings.ignorePatterns.push(value);
						await this.plugin.saveSettings();
						this.plugin.syncService.configure(
							this.plugin.settings.ignorePatterns,
							this.plugin.settings.subfolderPath
						);
						this.display();
					}
				}));

		// Sync Configuration Section
		containerEl.createEl('h2', { text: 'Sync Triggers' });
		containerEl.createEl('p', {
			text: 'Choose when the plugin should automatically sync with GitHub. Enable multiple triggers as needed.',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('Sync on file save')
			.setDesc('Automatically sync when you save a file')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncSchedule.syncOnSave)
				.onChange(async (value) => {
					this.plugin.settings.syncSchedule.syncOnSave = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync on interval')
			.setDesc('Automatically sync at regular intervals')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncSchedule.syncOnInterval)
				.onChange(async (value) => {
					this.plugin.settings.syncSchedule.syncOnInterval = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide interval slider
				}));

		// Only show interval slider if sync on interval is enabled
		if (this.plugin.settings.syncSchedule.syncOnInterval) {
			new Setting(containerEl)
				.setName('Sync interval (minutes)')
				.setDesc('How often to sync with GitHub')
				.addSlider(slider => slider
					.setLimits(5, 120, 5)
					.setValue(this.plugin.settings.syncSchedule.intervalMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.syncSchedule.intervalMinutes = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('Sync on startup')
			.setDesc('Automatically sync when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncSchedule.syncOnStartup)
				.onChange(async (value) => {
					this.plugin.settings.syncSchedule.syncOnStartup = value;
					await this.plugin.saveSettings();
				}));

		// Commit Configuration Section
		containerEl.createEl('h2', { text: 'Commit Settings' });

		new Setting(containerEl)
			.setName('Commit Message Template')
			.setDesc('Template for commit messages. Use {date}, {files}, {action}')
			.addText(text => text
				.setPlaceholder('Vault sync: {date}')
				.setValue(this.plugin.settings.commitConfig.messageTemplate)
				.onChange(async (value) => {
					this.plugin.settings.commitConfig.messageTemplate = value;
					await this.plugin.saveSettings();
				}));

		// Conflict Resolution Section
		containerEl.createEl('h2', { text: 'Conflict Resolution' });

		new Setting(containerEl)
			.setName('Default Resolution')
			.setDesc('How to handle conflicts when the same file is changed locally and remotely')
			.addDropdown(dropdown => dropdown
				.addOption('manual', 'Ask me each time')
				.addOption('keep-local', 'Keep local version')
				.addOption('keep-remote', 'Keep remote version')
				.addOption('keep-both', 'Keep both (rename)')
				.setValue(this.plugin.settings.defaultConflictResolution)
				.onChange(async (value: ConflictResolution) => {
					this.plugin.settings.defaultConflictResolution = value;
					await this.plugin.saveSettings();
				}));

		// UI Preferences Section
		containerEl.createEl('h2', { text: 'UI Preferences' });

		new Setting(containerEl)
			.setName('Show Status Bar')
			.setDesc('Show sync status in the status bar')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showStatusBar)
				.onChange(async (value) => {
					this.plugin.settings.showStatusBar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show Notifications')
			.setDesc('Show notifications for sync events')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showNotifications)
				.onChange(async (value) => {
					this.plugin.settings.showNotifications = value;
					await this.plugin.saveSettings();
				}));

		// Logging Section
		containerEl.createEl('h2', { text: 'Logging' });

		new Setting(containerEl)
			.setName('Enable Logging')
			.setDesc('Log sync operations for debugging')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.logging.enabled)
				.onChange(async (value) => {
					this.plugin.settings.logging.enabled = value;
					this.plugin.logger.configure({ enabled: value });
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Log Level')
			.setDesc('Minimum log level to record')
			.addDropdown(dropdown => dropdown
				.addOption('debug', 'Debug (verbose)')
				.addOption('info', 'Info (normal)')
				.addOption('warn', 'Warnings only')
				.addOption('error', 'Errors only')
				.setValue(this.plugin.settings.logging.level)
				.onChange(async (value: LogLevel) => {
					this.plugin.settings.logging.level = value;
					this.plugin.logger.configure({ level: value });
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Persist Logs to File')
			.setDesc('Save logs to a file in your vault')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.logging.persistToFile)
				.onChange(async (value) => {
					this.plugin.settings.logging.persistToFile = value;
					this.plugin.logger.configure({ persistToFile: value });
					await this.plugin.saveSettings();
				}));

		if (this.plugin.settings.logging.persistToFile) {
			new Setting(containerEl)
				.setName('Log File Path')
				.setDesc('Path for the log file (relative to vault root)')
				.addText(text => text
					.setPlaceholder('.github-sync.log')
					.setValue(this.plugin.settings.logging.logFilePath)
					.onChange(async (value) => {
						this.plugin.settings.logging.logFilePath = value || '.github-sync.log';
						this.plugin.logger.configure({ logFilePath: value || '.github-sync.log' });
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('View Logs')
			.setDesc('View recent log entries')
			.addButton(button => button
				.setButtonText('View Logs')
				.onClick(() => {
					new LogViewerModal(this.app, this.plugin.logger).open();
				}));

		new Setting(containerEl)
			.setName('Clear Logs')
			.setDesc('Clear all log entries from memory')
			.addButton(button => button
				.setButtonText('Clear')
				.setWarning()
				.onClick(() => {
					this.plugin.logger.clear();
					new Notice('Logs cleared');
				}));
	}

	/**
	 * Update the connection status display
	 */
	private updateConnectionStatus(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.plugin.githubService.isAuthenticated) {
			const user = this.plugin.githubService.user;
			containerEl.createEl('div', {
				text: `✅ Connected as ${user?.login}`,
				cls: 'github-octokit-status-connected',
			});
		} else if (this.plugin.settings.auth.token) {
			containerEl.createEl('div', {
				text: '⚠️ Token saved but not validated. Click Connect to verify.',
				cls: 'github-octokit-status-pending',
			});
		} else {
			containerEl.createEl('div', {
				text: '❌ Not connected. Enter a Personal Access Token to connect.',
				cls: 'github-octokit-status-disconnected',
			});
		}
	}

	/**
	 * Load repositories from GitHub
	 */
	private async loadRepositories(): Promise<void> {
		if (!this.plugin.githubService.isAuthenticated) {
			this.repositories = [];
			return;
		}

		try {
			this.repositories = await this.plugin.githubService.listRepositories();
		} catch (error) {
			console.error('Failed to load repositories:', error);
			new Notice('Failed to load repositories from GitHub');
			this.repositories = [];
		}
	}
}
