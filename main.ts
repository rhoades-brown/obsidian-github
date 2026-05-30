import { Menu, MenuItem, Notice, Plugin, TFile } from 'obsidian';
import { GitHubService } from './src/services/githubService';
import { SyncService, PersistedSyncState, SyncResult } from './src/services/syncService';
import { LoggerService } from './src/services/loggerService';
import { DiffView, DIFF_VIEW_TYPE } from './src/views/DiffView';
import { SyncView, SYNC_VIEW_TYPE } from './src/views/SyncView';
import { GitHubOctokitSettingTab, SyncModal } from './src/ui';
import { GitHubOctokitSettings, DEFAULT_SETTINGS, AdditionalRepoConfig, VaultRepoConfig, VAULT_REPOS_CONFIG_PATH } from './src/types/settings';

/** Per-repo runtime state for additional repositories */
export interface AdditionalRepoRuntime {
	config: AdditionalRepoConfig;
	githubService: GitHubService;
	syncService: SyncService;
	syncState: PersistedSyncState | null;
}

/** Shape of the data persisted via loadData/saveData */
interface PersistedPluginData extends Partial<GitHubOctokitSettings> {
	syncState?: PersistedSyncState | null;
	additionalRepoStates?: Record<string, PersistedSyncState | null>;
}

export default class GitHubOctokitPlugin extends Plugin {
	settings!: GitHubOctokitSettings;
	githubService!: GitHubService;
	syncService!: SyncService;
	logger!: LoggerService;
	private statusBarItem: HTMLElement | null = null;
	private syncState: PersistedSyncState | null = null;
	private additionalRepoStates: Record<string, PersistedSyncState | null> = {};
	private additionalRepos: Map<string, AdditionalRepoRuntime> = new Map();
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
			this.settings.subfolderPath,
			this.settings.syncConfiguration
		);

		// Register custom views
		this.registerView(DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf));
		this.registerView(SYNC_VIEW_TYPE, (leaf) => new SyncView(leaf, this));

		// Try to authenticate if we have a stored token
		if (this.settings.auth.token) {
			await this.validateAndConnect();
		}

		// Initialize additional repos
		await this.initializeAdditionalRepos();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('github', 'Sync with remote repository', async (evt: MouseEvent) => {
			if (evt.button === 0) {
				// Left click - trigger sync
				await this.performSync();
			}
		});
		ribbonIconEl.addClass('github-octokit-ribbon-class');

		// Right-click context menu
		ribbonIconEl.addEventListener('contextmenu', (evt: MouseEvent) => {
			evt.preventDefault();
			const menu = new Menu();

			menu.addItem((item: MenuItem) => {
				item.setTitle('Sync now')
					.setIcon('refresh-cw')
					.onClick(() => { void this.performSync(); });
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle('Pull from GitHub')
					.setIcon('download')
					.onClick(() => { void this.performSync('pull'); });
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle('Push to GitHub')
					.setIcon('upload')
					.onClick(() => { void this.performSync('push'); });
			});

			menu.addSeparator();

			menu.addItem((item: MenuItem) => {
				item.setTitle('Open sync panel')
					.setIcon('layout-sidebar-right')
					.onClick(() => { void this.openSyncView(); });
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle('Settings')
					.setIcon('settings')
					.onClick(() => {
						this.openSettings();
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
				this.openSettings();
			}
		});

		// This adds a settings tab
		this.addSettingTab(new GitHubOctokitSettingTab(this.app, this));

		// Set up auto-sync triggers
		this.setupAutoSync();

		// Sync on startup if enabled
		if (this.settings.syncSchedule.syncOnStartup && this.githubService.isAuthenticated && this.settings.repo) {
			window.setTimeout(() => { void this.performSync(); }, 3000); // Delay to let Obsidian fully load
		}

		// First-run setup notice
		if (!this.settings.auth.token) {
			window.setTimeout(() => {
				new Notice(
					'Welcome! Open settings to configure sync with your remote repository.',
					15000
				);
			}, 2000);
		}
	}

	onunload() {
		this.githubService.disconnect();
		for (const runtime of this.additionalRepos.values()) {
			runtime.githubService.disconnect();
		}
		this.additionalRepos.clear();
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
			// Update sync service config with additional repo exclusions
			this.syncService.configure(
				this.getMainRepoIgnorePatterns(),
				this.settings.subfolderPath,
				this.settings.syncConfiguration
			);
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
	 * Get the additional repo runtime instances (for SyncView)
	 */
	getAdditionalRepos(): Map<string, AdditionalRepoRuntime> {
		return this.additionalRepos;
	}

	/**
	 * Get ignore patterns for the main repo, including additional repo directories
	 */
	getMainRepoIgnorePatterns(): string[] {
		const patterns = [...this.settings.ignorePatterns];
		// Exclude additional repo directories from main repo sync
		for (const repoConfig of this.settings.additionalRepos) {
			if (repoConfig.enabled && repoConfig.localPath) {
				const dirPattern = `${repoConfig.localPath}/**`;
				if (!patterns.includes(dirPattern)) {
					patterns.push(dirPattern);
				}
			}
		}
		return patterns;
	}

	/**
	 * Initialize additional repo services and authenticate them
	 */
	async initializeAdditionalRepos(): Promise<void> {
		// Clean up existing
		for (const runtime of this.additionalRepos.values()) {
			runtime.githubService.disconnect();
		}
		this.additionalRepos.clear();

		for (const repoConfig of this.settings.additionalRepos) {
			if (!repoConfig.enabled) continue;

			const token = repoConfig.useMainToken
				? this.settings.auth.token
				: repoConfig.token;

			if (!token) {
				this.logger.warn('AdditionalRepo', `No token for ${repoConfig.owner}/${repoConfig.repo}, skipping`);
				continue;
			}

			const ghService = new GitHubService();
			const authenticated = await ghService.authenticate(token);

			if (!authenticated) {
				this.logger.warn('AdditionalRepo', `Failed to authenticate ${repoConfig.owner}/${repoConfig.repo}`);
				continue;
			}

			const syncService = new SyncService(
				this.app,
				ghService,
				repoConfig.ignorePatterns,
				repoConfig.subfolderPath,
				false, // No config sync for additional repos
				repoConfig.localPath
			);

			this.additionalRepos.set(repoConfig.id, {
				config: repoConfig,
				githubService: ghService,
				syncService,
				syncState: this.additionalRepoStates[repoConfig.id] || null,
			});

			this.logger.info('AdditionalRepo', `Initialized ${repoConfig.owner}/${repoConfig.repo} → ${repoConfig.localPath}`);
		}

		// Update main repo ignore patterns to exclude additional repo directories
		this.syncService.configure(
			this.getMainRepoIgnorePatterns(),
			this.settings.subfolderPath,
			this.settings.syncConfiguration
		);
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
		this.statusBarItem.addEventListener('click', () => {
			if (this.githubService.isAuthenticated) {
				void this.openSyncView();
			} else {
				this.openSettings();
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
				void this.performSync();
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
			void this.performSync();
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

			// Sync additional repos
			await this.syncAdditionalRepos(direction, commitMessage);

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
			void this.handleSyncError(error);
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

	/**
	 * Sync all enabled additional repositories
	 */
	private async syncAdditionalRepos(direction: 'pull' | 'push' | 'sync', commitMessage: string): Promise<void> {
		for (const [id, runtime] of this.additionalRepos) {
			try {
				const { config, syncService, syncState } = runtime;
				this.logger.info('AdditionalRepo', `Syncing ${config.owner}/${config.repo}`, { direction });

				const { result: repoResult, newState: repoNewState } = await syncService.sync(
					config.owner,
					config.repo,
					config.branch,
					commitMessage,
					syncState || undefined,
					{ direction }
				);

				// Update runtime state
				runtime.syncState = repoNewState;
				this.additionalRepoStates[id] = repoNewState;
				await this.saveSyncState();

				if (repoResult.filesProcessed > 0) {
					this.logger.info('AdditionalRepo', `${config.owner}/${config.repo}: ${repoResult.filesPulled} pulled, ${repoResult.filesPushed} pushed`);
				}

				if (repoResult.errors.length > 0) {
					this.logger.error('AdditionalRepo', `Errors in ${config.owner}/${config.repo}`, { errors: repoResult.errors });
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				this.logger.error('AdditionalRepo', `Failed to sync ${runtime.config.owner}/${runtime.config.repo}: ${msg}`);
			}
		}
	}

	async loadSettings() {
		const data = (await this.loadData() || {}) as PersistedPluginData;
		// Extract syncState and additionalRepoStates before merging with defaults
		const { syncState: _ignored, additionalRepoStates: _ignored2, ...settingsData } = data;
		void _ignored; // intentionally unused - just extracting syncState from data
		void _ignored2;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);

		// Load additional repo configs from vault file and merge
		await this.loadVaultRepoConfig();

		// Migrate main token from plaintext data.json to SecretStorage
		const storedSecret = this.app.secretStorage.getSecret('github-pat');
		if (storedSecret) {
			// Token already in SecretStorage — use it
			this.settings.auth.token = storedSecret;
		} else if (this.settings.auth.token) {
			// Legacy: token still in data.json — migrate to SecretStorage
			this.app.secretStorage.setSecret('github-pat', this.settings.auth.token);
		}

		// Migrate additional repo tokens to SecretStorage
		let needsSave = false;
		for (const repo of this.settings.additionalRepos) {
			if (repo.useMainToken) continue;
			const secretKey = `github-pat-${repo.id}`;
			const repoSecret = this.app.secretStorage.getSecret(secretKey);
			if (repoSecret) {
				repo.token = repoSecret;
			} else if (repo.token) {
				this.app.secretStorage.setSecret(secretKey, repo.token);
				needsSave = true;
			}
		}

		// Clear legacy tokens from data.json if any were migrated
		if (needsSave || (!storedSecret && this.settings.auth.token)) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		// Preserve syncState when saving settings
		const data = (await this.loadData() || {}) as PersistedPluginData;

		// Persist main token to SecretStorage
		if (this.settings.auth.token) {
			this.app.secretStorage.setSecret('github-pat', this.settings.auth.token);
		}

		// Persist additional repo tokens to SecretStorage
		const cleanedRepos = this.settings.additionalRepos.map(repo => {
			if (!repo.useMainToken && repo.token) {
				this.app.secretStorage.setSecret(`github-pat-${repo.id}`, repo.token);
			}
			return { ...repo, token: '' };
		});

		// Exclude all tokens from persisted settings
		const settingsToSave = {
			...this.settings,
			auth: { ...this.settings.auth, token: '' },
			additionalRepos: cleanedRepos,
		};

		await this.saveData({
			...settingsToSave,
			syncState: data.syncState,
			additionalRepoStates: data.additionalRepoStates,
		});

		// Persist repo configs to vault file so they sync with the primary repo
		await this.saveVaultRepoConfig();
	}

	/**
	 * Load additional repo configs from the vault file (.github-sync-repos.json).
	 * Merges vault-file entries with any existing entries in data.json,
	 * using the vault file as the source of truth for structural config.
	 * Tokens are resolved separately from SecretStorage.
	 */
	private async loadVaultRepoConfig(): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(VAULT_REPOS_CONFIG_PATH);
			if (!exists) return;

			const raw = await this.app.vault.adapter.read(VAULT_REPOS_CONFIG_PATH);
			const vaultConfigs = JSON.parse(raw) as VaultRepoConfig[];
			if (!Array.isArray(vaultConfigs)) return;

			// Build a map of existing settings repos by id for token lookup
			const existingById = new Map<string, AdditionalRepoConfig>();
			for (const repo of this.settings.additionalRepos) {
				existingById.set(repo.id, repo);
			}

			// Merge: vault file is source of truth for config,
			// existing settings provide the token (which will be resolved from SecretStorage later)
			this.settings.additionalRepos = vaultConfigs.map(vc => {
				const existing = existingById.get(vc.id);
				return {
					...vc,
					token: existing?.token ?? '',
				};
			});
		} catch {
			// File doesn't exist or is malformed — no-op, use data.json repos
		}
	}

	/**
	 * Save additional repo configs to the vault file (.github-sync-repos.json).
	 * Strips tokens before writing so secrets never end up in the vault.
	 * Uses the Vault API (create/modify) so the file is tracked in the vault
	 * index and included in sync operations.
	 */
	private async saveVaultRepoConfig(): Promise<void> {
		const vaultConfigs: VaultRepoConfig[] = this.settings.additionalRepos.map(
			({ token: _token, ...rest }) => {
				void _token;
				return rest;
			}
		);

		const json = JSON.stringify(vaultConfigs, null, '\t');

		try {
			const existing = this.app.vault.getAbstractFileByPath(VAULT_REPOS_CONFIG_PATH);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, json);
			} else if (vaultConfigs.length > 0) {
				// Only create the file if there are repos to persist
				await this.app.vault.create(VAULT_REPOS_CONFIG_PATH, json);
			}
		} catch (error) {
			console.error('Failed to save vault repo config:', error);
		}
	}

	async loadSyncState() {
		const data = await this.loadData() as PersistedPluginData | null;
		this.syncState = data?.syncState || null;
		this.additionalRepoStates = data?.additionalRepoStates || {};
	}

	async saveSyncState() {
		// Preserve settings when saving syncState
		const data = (await this.loadData() || {}) as PersistedPluginData;
		data.syncState = this.syncState;
		data.additionalRepoStates = this.additionalRepoStates;
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
			void this.app.workspace.revealLeaf(existing[0]);
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

		void this.app.workspace.revealLeaf(leaf);
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

	/**
	 * Open the plugin settings tab
	 */
	openSettings(): void {
		const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
		setting.open();
		setting.openTabById('github-octokit');
	}
}
