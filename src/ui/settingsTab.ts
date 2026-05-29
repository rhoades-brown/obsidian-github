import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type { GitHubRepo } from '../services/githubService';
import { LogLevel } from '../services/loggerService';
import { AdditionalRepoConfig } from '../types/settings';
import { LogViewerModal } from './modals/LogViewerModal';
import type GitHubOctokitPlugin from '../../main';

// ============================================================================
// Dot-notation helpers for nested settings
// ============================================================================

function getPath(obj: Record<string, unknown>, path: string): unknown {
	let cursor: unknown = obj;
	for (const part of path.split('.')) {
		if (cursor === null || typeof cursor !== 'object') return undefined;
		cursor = (cursor as Record<string, unknown>)[part];
	}
	return cursor;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split('.');
	const last = parts.pop()!;
	let cursor: Record<string, unknown> = obj;
	for (const part of parts) {
		let next = cursor[part];
		if (next === null || typeof next !== 'object') {
			next = {};
			cursor[part] = next;
		}
		cursor = next as Record<string, unknown>;
	}
	cursor[last] = value;
}

/**
 * Settings tab for the GitHub Octokit plugin.
 *
 * Uses the declarative settings API introduced in Obsidian 1.13.0.
 * Settings are defined via getSettingDefinitions() and the framework
 * handles rendering, search indexing, and auto-save.
 */
export class GitHubOctokitSettingTab extends PluginSettingTab {
	plugin: GitHubOctokitPlugin;
	private repositories: GitHubRepo[] = [];

	constructor(app: App, plugin: GitHubOctokitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// ========================================================================
	// Dot-notation read/write for nested settings (auth.token, etc.)
	// ========================================================================

	getControlValue(key: string): unknown {
		return getPath(
			this.plugin.settings as unknown as Record<string, unknown>,
			key,
		);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		setPath(
			this.plugin.settings as unknown as Record<string, unknown>,
			key,
			value,
		);
		await this.plugin.saveData(this.plugin.settings);
	}

	// ========================================================================
	// Declarative definitions
	// ========================================================================

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...this.authDefinitions(),
			...this.repoDefinitions(),
			this.additionalReposDefinition(),
			this.ignorePatternsDefinition(),
			...this.syncBehaviorDefinitions(),
			...this.commitDefinitions(),
			...this.conflictDefinitions(),
			...this.uiDefinitions(),
			...this.loggingDefinitions(),
		];
	}

	// ========================================================================
	// Authentication
	// ========================================================================

	private authDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'GitHub authentication',
				items: [
					{
						name: 'Connection status',
						render: (setting) => {
							const statusEl = setting.settingEl.createDiv({ cls: 'github-octokit-status' });
							this.updateConnectionStatus(statusEl);
							setting.settingEl.prepend(statusEl);
							setting.settingEl.querySelector('.setting-item-info')?.remove();
							setting.settingEl.querySelector('.setting-item-control')?.remove();
						},
					},
					{
						name: 'Personal access token',
						desc: 'Personal access token with repo access. Create one in your account developer settings.',
						render: (setting) => {
							setting
								.addText(text => {
									text
										.setPlaceholder('Paste token here')
										.setValue(this.plugin.settings.auth.token)
										.onChange(async (value) => {
											this.plugin.settings.auth.token = value;
											this.plugin.settings.auth.tokenValidated = false;
											await this.plugin.saveSettings();
										});
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

										this.update();
									}));
						},
					},
				],
			},
		];
	}

	// ========================================================================
	// Repository
	// ========================================================================

	private repoDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Repository',
				items: [
					{
						name: 'Repository',
						desc: 'Select a repository to sync with',
						render: (setting) => {
							if (this.plugin.settings.auth.tokenValidated) {
								setting.addDropdown(async dropdown => {
									dropdown.addOption('', 'Select a repository...');

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
												this.update();
											}
										} else {
											this.plugin.settings.repo = null;
											await this.plugin.saveSettings();
											this.plugin.updateStatusBar();
										}
									});
								});
							} else {
								setting.addDropdown(dropdown => dropdown
									.addOption('', 'Connect to GitHub first...')
									.setDisabled(true));
							}
						},
					},
					{
						name: 'Branch',
						desc: 'Branch to sync with',
						visible: () => this.plugin.settings.repo !== null,
						render: (setting) => {
							setting.addText(text => text
								.setPlaceholder('Main')
								.setValue(this.plugin.settings.repo?.branch ?? 'main')
								.onChange(async (value) => {
									if (this.plugin.settings.repo) {
										this.plugin.settings.repo.branch = value || 'main';
										await this.plugin.saveSettings();
									}
								}));
						},
					},
					{
						name: 'Subfolder path',
						desc: 'Optional: sync vault to a subfolder in the repo (e.g., "notes/Obsidian")',
						control: { type: 'text', key: 'subfolderPath', placeholder: '/' },
					},
				],
			},
		];
	}

	// ========================================================================
	// Additional repositories
	// ========================================================================

	private additionalReposDefinition(): SettingDefinitionItem {
		const repos = this.plugin.settings.additionalRepos;

		return {
			type: 'list',
			heading: 'Additional repositories',
			cls: 'github-octokit-additional-repos',
			emptyState: 'No additional repositories configured.',
			addItem: {
				name: 'Add repository',
				action: () => {
					repos.push({
						id: this.generateId(),
						owner: '',
						repo: '',
						branch: 'main',
						localPath: '',
						useMainToken: true,
						token: '',
						subfolderPath: '',
						ignorePatterns: [],
						enabled: true,
					});
					void this.plugin.saveSettings().then(() => this.update());
				},
			},
			onDelete: (idx: number) => {
				repos.splice(idx, 1);
				void this.plugin.saveSettings().then(() =>
					this.plugin.initializeAdditionalRepos().then(() => this.update()),
				);
			},
			items: repos.map((repoConfig) => ({
				type: 'page' as const,
				name: repoConfig.owner && repoConfig.repo
					? `${repoConfig.owner}/${repoConfig.repo}`
					: 'New repository',
				desc: repoConfig.enabled ? 'Enabled' : 'Disabled',
				items: this.additionalRepoPageItems(repoConfig),
			})),
		};
	}

	private additionalRepoPageItems(repoConfig: AdditionalRepoConfig): SettingDefinitionItem[] {
		return [
			{
				name: 'Enabled',
				desc: 'Enable or disable this repository',
				render: (setting) => {
					setting.addToggle(toggle => toggle
						.setValue(repoConfig.enabled)
						.onChange(async (value) => {
							repoConfig.enabled = value;
							await this.plugin.saveSettings();
							await this.plugin.initializeAdditionalRepos();
						}));
				},
			},
			{
				name: 'Owner',
				desc: 'GitHub user or organization',
				render: (setting) => {
					setting.addText(text => text
						.setPlaceholder('Owner')
						.setValue(repoConfig.owner)
						.onChange(async (value) => {
							repoConfig.owner = value.trim();
							await this.plugin.saveSettings();
						}));
				},
			},
			{
				name: 'Repository name',
				render: (setting) => {
					setting.addText(text => text
						.setPlaceholder('Repo name')
						.setValue(repoConfig.repo)
						.onChange(async (value) => {
							repoConfig.repo = value.trim();
							await this.plugin.saveSettings();
						}));
				},
			},
			{
				name: 'Branch',
				render: (setting) => {
					setting.addText(text => text
						.setPlaceholder('Main')
						.setValue(repoConfig.branch)
						.onChange(async (value) => {
							repoConfig.branch = value.trim() || 'main';
							await this.plugin.saveSettings();
						}));
				},
			},
			{
				name: 'Vault directory',
				desc: 'Directory in the vault to sync this repo into',
				render: (setting) => {
					setting.addText(text => text
						.setPlaceholder('My other repo')
						.setValue(repoConfig.localPath)
						.onChange(async (value) => {
							const trimmed = value.trim();
							const overlap = this.validateLocalPath(trimmed, repoConfig.id);
							if (overlap) {
								new Notice(overlap);
								return;
							}
							repoConfig.localPath = trimmed;
							await this.plugin.saveSettings();
							await this.plugin.initializeAdditionalRepos();
						}));
				},
			},
			{
				name: 'Use main token',
				desc: 'Use the same token as the main repository',
				render: (setting) => {
					setting.addToggle(toggle => toggle
						.setValue(repoConfig.useMainToken)
						.onChange(async (value) => {
							repoConfig.useMainToken = value;
							await this.plugin.saveSettings();
							this.update();
						}));
				},
			},
			{
				name: 'Personal access token',
				visible: () => !repoConfig.useMainToken,
				render: (setting) => {
					setting.addText(text => {
						text.inputEl.type = 'password';
						text
							.setPlaceholder('Paste token here')
							.setValue(repoConfig.token)
							.onChange(async (value) => {
								repoConfig.token = value;
								await this.plugin.saveSettings();
							});
					});
				},
			},
			{
				name: 'Subfolder path',
				desc: 'Optional: sync a subfolder of the remote repo',
				render: (setting) => {
					setting.addText(text => text
						.setPlaceholder('E.g., docs/notes')
						.setValue(repoConfig.subfolderPath)
						.onChange(async (value) => {
							repoConfig.subfolderPath = value.trim();
							await this.plugin.saveSettings();
						}));
				},
			},
		];
	}

	/**
	 * Validate that a local path does not overlap with other repos
	 */
	private validateLocalPath(localPath: string, excludeId: string): string | null {
		if (!localPath) return null;

		for (const repo of this.plugin.settings.additionalRepos) {
			if (repo.id === excludeId) continue;
			if (!repo.localPath) continue;

			// Check for exact match
			if (repo.localPath === localPath) {
				return `Path "${localPath}" is already used by ${repo.owner}/${repo.repo}`;
			}

			// Check for nesting
			if (localPath.startsWith(repo.localPath + '/') || repo.localPath.startsWith(localPath + '/')) {
				return `Path "${localPath}" overlaps with ${repo.owner}/${repo.repo} (${repo.localPath})`;
			}
		}
		return null;
	}

	/**
	 * Generate a simple unique ID
	 */
	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
	}

	// ========================================================================
	// Ignore patterns
	// ========================================================================

	private ignorePatternsDefinition(): SettingDefinitionItem {
		const patterns = this.plugin.settings.ignorePatterns;

		return {
			type: 'list',
			heading: 'Ignore patterns',
			cls: 'github-octokit-ignore-patterns',
			emptyState: 'No ignore patterns configured.',
			addItem: {
				name: 'Add pattern',
				action: () => {
					patterns.push('');
					void this.plugin.saveSettings().then(() => this.update());
				},
			},
			onDelete: (idx: number) => {
				patterns.splice(idx, 1);
				void this.plugin.saveSettings().then(() => {
					this.plugin.syncService.configure(
						this.plugin.getMainRepoIgnorePatterns(),
						this.plugin.settings.subfolderPath,
						this.plugin.settings.syncConfiguration
					);
					this.update();
				});
			},
			items: patterns.map((pattern, idx) => ({
				name: pattern || 'New pattern',
				render: (setting: Setting) => {
					setting.addText(text => text
						.setPlaceholder(`${this.plugin.app.vault.configDir}/cache/**`)
						.setValue(pattern)
						.onChange(async (value) => {
							patterns[idx] = value.trim();
							await this.plugin.saveSettings();
							this.plugin.syncService.configure(
								this.plugin.getMainRepoIgnorePatterns(),
								this.plugin.settings.subfolderPath,
								this.plugin.settings.syncConfiguration
							);
						}));
				},
			})),
		};
	}

	// ========================================================================
	// Sync behavior
	// ========================================================================

	private syncBehaviorDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Sync behavior',
				items: [
					{
						name: 'Sync configuration folder',
						desc: `Include the ${this.plugin.app.vault.configDir} folder in sync. When disabled, all configuration files are excluded.`,
						render: (setting) => {
							setting.addToggle(toggle => toggle
								.setValue(this.plugin.settings.syncConfiguration)
								.onChange(async (value) => {
									this.plugin.settings.syncConfiguration = value;
									await this.plugin.saveSettings();
									this.plugin.syncService.configure(
										this.plugin.getMainRepoIgnorePatterns(),
										this.plugin.settings.subfolderPath,
										this.plugin.settings.syncConfiguration
									);
								}));
						},
					},
					{
						name: 'Sync on file save',
						desc: 'Automatically sync when you save a file',
						control: { type: 'toggle', key: 'syncSchedule.syncOnSave' },
					},
					{
						name: 'Sync on interval',
						desc: 'Automatically sync at regular intervals',
						render: (setting) => {
							setting.addToggle(toggle => toggle
								.setValue(this.plugin.settings.syncSchedule.syncOnInterval)
								.onChange(async (value) => {
									this.plugin.settings.syncSchedule.syncOnInterval = value;
									await this.plugin.saveSettings();
									this.update();
								}));
						},
					},
					{
						name: 'Sync interval (minutes)',
						desc: 'How often to sync with GitHub',
						visible: () => this.plugin.settings.syncSchedule.syncOnInterval,
						control: {
							type: 'slider',
							key: 'syncSchedule.intervalMinutes',
							min: 5,
							max: 120,
							step: 5,
						},
					},
					{
						name: 'Sync on startup',
						desc: 'Automatically sync when Obsidian starts',
						control: { type: 'toggle', key: 'syncSchedule.syncOnStartup' },
					},
				],
			},
		];
	}

	// ========================================================================
	// Commit messages
	// ========================================================================

	private commitDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Commit messages',
				items: [
					{
						name: 'Commit message template',
						desc: 'Template for commit messages. Use {date}, {files}, {action}',
						control: {
							type: 'text',
							key: 'commitConfig.messageTemplate',
							placeholder: 'Vault sync: {date}',
						},
					},
				],
			},
		];
	}

	// ========================================================================
	// Conflict resolution
	// ========================================================================

	private conflictDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Conflict resolution',
				items: [
					{
						name: 'Default resolution',
						desc: 'How to handle conflicts when the same file is changed locally and remotely',
						control: {
							type: 'dropdown',
							key: 'defaultConflictResolution',
							options: {
								'manual': 'Ask me each time',
								'keep-local': 'Keep local version',
								'keep-remote': 'Keep remote version',
								'keep-both': 'Keep both (rename)',
							},
						},
					},
				],
			},
		];
	}

	// ========================================================================
	// UI preferences
	// ========================================================================

	private uiDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'UI preferences',
				items: [
					{
						name: 'Show status bar',
						desc: 'Show sync status in the status bar',
						control: { type: 'toggle', key: 'showStatusBar' },
					},
					{
						name: 'Show notifications',
						desc: 'Show notifications for sync events',
						control: { type: 'toggle', key: 'showNotifications' },
					},
				],
			},
		];
	}

	// ========================================================================
	// Logging
	// ========================================================================

	private loggingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Logging',
				items: [
					{
						name: 'Enable logging',
						desc: 'Log sync operations for debugging',
						render: (setting) => {
							setting.addToggle(toggle => toggle
								.setValue(this.plugin.settings.logging.enabled)
								.onChange(async (value) => {
									this.plugin.settings.logging.enabled = value;
									this.plugin.logger.configure({ enabled: value });
									await this.plugin.saveSettings();
								}));
						},
					},
					{
						name: 'Log level',
						desc: 'Minimum log level to record',
						render: (setting) => {
							setting.addDropdown(dropdown => dropdown
								.addOption('debug', 'Debug (verbose)')
								.addOption('info', 'Info (normal)')
								.addOption('warn', 'Warnings only')
								.addOption('error', 'Errors only')
								.setValue(this.plugin.settings.logging.level)
								.onChange(async (value: string) => {
									this.plugin.settings.logging.level = value as LogLevel;
									this.plugin.logger.configure({ level: value as LogLevel });
									await this.plugin.saveSettings();
								}));
						},
					},
					{
						name: 'Persist logs to file',
						desc: 'Save logs to a file in your vault',
						render: (setting) => {
							setting.addToggle(toggle => toggle
								.setValue(this.plugin.settings.logging.persistToFile)
								.onChange(async (value) => {
									this.plugin.settings.logging.persistToFile = value;
									this.plugin.logger.configure({ persistToFile: value });
									await this.plugin.saveSettings();
									this.update();
								}));
						},
					},
					{
						name: 'Log file path',
						desc: 'Path for the log file (relative to vault root)',
						visible: () => this.plugin.settings.logging.persistToFile,
						render: (setting) => {
							setting.addText(text => text
								.setPlaceholder('Enter log file path')
								.setValue(this.plugin.settings.logging.logFilePath)
								.onChange(async (value) => {
									this.plugin.settings.logging.logFilePath = value || '.github-sync.log';
									this.plugin.logger.configure({ logFilePath: value || '.github-sync.log' });
									await this.plugin.saveSettings();
								}));
						},
					},
					{
						name: 'View logs',
						desc: 'View recent log entries',
						render: (setting) => {
							setting.addButton(button => button
								.setButtonText('View logs')
								.onClick(() => {
									new LogViewerModal(this.app, this.plugin.logger).open();
								}));
						},
					},
					{
						name: 'Clear logs',
						desc: 'Clear all log entries from memory',
						render: (setting) => {
							setting.addButton(button => button
								.setButtonText('Clear')
								.setDestructive()
								.onClick(() => {
									this.plugin.logger.clear();
									new Notice('Logs cleared');
								}));
						},
					},
				],
			},
		];
	}

	private updateConnectionStatus(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.plugin.githubService.isAuthenticated) {
			const user = this.plugin.githubService.user;
			containerEl.createDiv({
				text: `✅ Connected as ${user?.login}`,
				cls: 'github-octokit-status-connected',
			});
		} else if (this.plugin.settings.auth.token) {
			containerEl.createDiv({
				text: 'Token saved but not validated. Click connect to verify.',
				cls: 'github-octokit-status-pending',
			});
		} else {
			containerEl.createDiv({
				text: 'Not connected. Enter a personal access token to connect.',
				cls: 'github-octokit-status-disconnected',
			});
		}
	}

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

