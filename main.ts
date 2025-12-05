import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { GitHubService, type GitHubRepo } from './src/services/githubService';
import { SyncService, PersistedSyncState, SyncResult } from './src/services/syncService';

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
		'.git/**',
		'.gitignore',
	],
	showStatusBar: true,
	showNotifications: true,
}

export default class GitHubOctokitPlugin extends Plugin {
	settings: GitHubOctokitSettings;
	githubService: GitHubService;
	syncService: SyncService;
	private statusBarItem: HTMLElement | null = null;
	private syncState: PersistedSyncState | null = null;
	private syncIntervalId: number | null = null;
	private isSyncing = false;

	async onload() {
		await this.loadSettings();
		await this.loadSyncState();

		// Initialize services
		this.githubService = new GitHubService();
		this.syncService = new SyncService(
			this.app,
			this.githubService,
			this.settings.ignorePatterns,
			this.settings.subfolderPath
		);

		// Try to authenticate if we have a stored token
		if (this.settings.auth.token) {
			await this.validateAndConnect();
		}

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('github', 'GitHub Octokit', async (_evt: MouseEvent) => {
			// Called when the user clicks the icon - trigger sync
			await this.performSync();
		});
		ribbonIconEl.addClass('github-octokit-ribbon-class');

		// This adds a status bar item to the bottom of the app.
		if (this.settings.showStatusBar) {
			this.statusBarItem = this.addStatusBarItem();
			this.updateStatusBar();
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

		// This adds a settings tab
		this.addSettingTab(new GitHubOctokitSettingTab(this.app, this));

		// Set up auto-sync triggers
		this.setupAutoSync();

		// Sync on startup if enabled
		if (this.settings.syncSchedule.syncOnStartup && this.githubService.isAuthenticated && this.settings.repo) {
			setTimeout(() => this.performSync(), 3000); // Delay to let Obsidian fully load
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

		if (this.isSyncing) {
			this.statusBarItem.setText('GitHub: Syncing...');
		} else if (this.githubService.isAuthenticated) {
			const user = this.githubService.user?.login || 'Unknown';
			const repo = this.settings.repo?.name || 'No repo';
			this.statusBarItem.setText(`GitHub: ${user}/${repo}`);
		} else {
			this.statusBarItem.setText('GitHub: Not connected');
		}
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
			new Notice('Sync already in progress...');
			return null;
		}

		if (!this.githubService.isAuthenticated) {
			new Notice('Not connected to GitHub. Configure in settings.');
			return null;
		}

		if (!this.settings.repo) {
			new Notice('No repository selected. Configure in settings.');
			return null;
		}

		this.isSyncing = true;
		this.updateStatusBar();

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
			new Notice(`Sync error: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		} finally {
			this.isSyncing = false;
			this.updateStatusBar();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadSyncState() {
		const data = await this.loadData();
		this.syncState = data?.syncState || null;
	}

	async saveSyncState() {
		const data = await this.loadData() || {};
		data.syncState = this.syncState;
		await this.saveData(data);
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
