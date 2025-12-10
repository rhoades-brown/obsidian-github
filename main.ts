import { Notice, Plugin, TFile } from 'obsidian';
import { GitHubService } from './src/services/githubService';
import { SyncService, PersistedSyncState, SyncResult } from './src/services/syncService';
import { LoggerService } from './src/services/loggerService';
import { DiffView, DIFF_VIEW_TYPE } from './src/views/DiffView';
import { SyncView, SYNC_VIEW_TYPE } from './src/views/SyncView';
import { GitHubOctokitSettingTab, SyncModal } from './src/ui';
import { GitHubOctokitSettings, DEFAULT_SETTINGS } from './src/types/settings';

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
				new SyncModal(this.app).open();
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
