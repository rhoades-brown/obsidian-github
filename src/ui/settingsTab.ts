import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { GitHubRepo } from '../services/githubService';
import { LogLevel } from '../services/loggerService';
import { AdditionalRepoConfig, ConflictResolution } from '../types/settings';
import { LogViewerModal } from './modals/LogViewerModal';
import type GitHubOctokitPlugin from '../../main';

/**
 * Settings tab for the GitHub Octokit plugin
 */
export class GitHubOctokitSettingTab extends PluginSettingTab {
	plugin: GitHubOctokitPlugin;
	private repositories: GitHubRepo[] = [];

	constructor(app: App, plugin: GitHubOctokitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderAuthSection(containerEl);
		this.renderRepoSection(containerEl);
		this.renderAdditionalReposSection(containerEl);
		this.renderIgnorePatternsSection(containerEl);
		this.renderSyncTriggersSection(containerEl);
		this.renderCommitSection(containerEl);
		this.renderConflictSection(containerEl);
		this.renderUISection(containerEl);
		this.renderLoggingSection(containerEl);
	}

	private renderAuthSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('GitHub authentication').setHeading();

		// Connection status
		const statusEl = containerEl.createDiv({ cls: 'github-octokit-status' });
		this.updateConnectionStatus(statusEl);

		new Setting(containerEl)
			.setName('Personal access token')
			.setDesc('Personal access token with repo access. Create one in your account developer settings.')
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

					// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
					this.display();
				}));
	}

	private renderRepoSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Repository').setHeading();

		const repoSetting = new Setting(containerEl)
			.setName('Repository')
			.setDesc('Select a repository to sync with');

		if (this.plugin.settings.auth.tokenValidated) {
			repoSetting.addDropdown(async dropdown => {
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
							// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
							this.display();
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

		if (this.plugin.settings.repo) {
			new Setting(containerEl)
				.setName('Branch')
				.setDesc('Branch to sync with')
				.addText(text => text
					.setPlaceholder('Main')
					.setValue(this.plugin.settings.repo?.branch ?? 'main')
					.onChange(async (value) => {
						if (this.plugin.settings.repo) {
							this.plugin.settings.repo.branch = value || 'main';
							await this.plugin.saveSettings();
						}
					}));
		}

		new Setting(containerEl)
			.setName('Subfolder path')
			.setDesc('Optional: sync vault to a subfolder in the repo (e.g., "notes/Obsidian")')
			.addText(text => text
				.setPlaceholder('/')
				.setValue(this.plugin.settings.subfolderPath)
				.onChange(async (value) => {
					this.plugin.settings.subfolderPath = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderAdditionalReposSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Additional repositories').setHeading();
		new Setting(containerEl)
			.setDesc('Sync additional GitHub repositories into specific vault directories. Each repo is synced independently.');

		// Render existing additional repos
		for (const repoConfig of this.plugin.settings.additionalRepos) {
			this.renderAdditionalRepoEntry(containerEl, repoConfig);
		}

		// Add new repo button
		new Setting(containerEl)
			.setName('Add repository')
			.addButton(button => button
				.setButtonText('Add')
				.setCta()
				.onClick(async () => {
					const newRepo: AdditionalRepoConfig = {
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
					};
					this.plugin.settings.additionalRepos.push(newRepo);
					await this.plugin.saveSettings();
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
					this.display();
				}));
	}

	private renderAdditionalRepoEntry(containerEl: HTMLElement, repoConfig: AdditionalRepoConfig): void {
		const repoContainer = containerEl.createDiv({ cls: 'github-octokit-additional-repo' });
		const index = this.plugin.settings.additionalRepos.indexOf(repoConfig);

		// Header with repo name and controls
		const headerLabel = repoConfig.owner && repoConfig.repo
			? `${repoConfig.owner}/${repoConfig.repo}`
			: 'New repository';

		new Setting(repoContainer)
			.setName(headerLabel)
			.addToggle(toggle => toggle
				.setValue(repoConfig.enabled)
				.setTooltip('Enable or disable this repository')
				.onChange(async (value) => {
					repoConfig.enabled = value;
					await this.plugin.saveSettings();
					await this.plugin.initializeAdditionalRepos();
				}))
			.addButton(button => button
				.setIcon('trash')
				.setTooltip('Remove repository')
				.onClick(async () => {
					this.plugin.settings.additionalRepos.splice(index, 1);
					await this.plugin.saveSettings();
					await this.plugin.initializeAdditionalRepos();
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
					this.display();
				}));

		// Owner
		new Setting(repoContainer)
			.setName('Owner')
			.setDesc('GitHub user or organization')
			.addText(text => text
				.setPlaceholder('Owner')
				.setValue(repoConfig.owner)
				.onChange(async (value) => {
					repoConfig.owner = value.trim();
					await this.plugin.saveSettings();
				}));

		// Repo name
		new Setting(repoContainer)
			.setName('Repository name')
			.addText(text => text
				.setPlaceholder('Repo name')
				.setValue(repoConfig.repo)
				.onChange(async (value) => {
					repoConfig.repo = value.trim();
					await this.plugin.saveSettings();
				}));

		// Branch
		new Setting(repoContainer)
			.setName('Branch')
			.addText(text => text
				.setPlaceholder('Main')
				.setValue(repoConfig.branch)
				.onChange(async (value) => {
					repoConfig.branch = value.trim() || 'main';
					await this.plugin.saveSettings();
				}));

		// Local path
		new Setting(repoContainer)
			.setName('Vault directory')
			.setDesc('Directory in the vault to sync this repo into')
			.addText(text => text
				.setPlaceholder('My other repo')
				.setValue(repoConfig.localPath)
				.onChange(async (value) => {
					const trimmed = value.trim();
					// Validate no overlap with other repos
					const overlap = this.validateLocalPath(trimmed, repoConfig.id);
					if (overlap) {
						new Notice(overlap);
						return;
					}
					repoConfig.localPath = trimmed;
					await this.plugin.saveSettings();
					await this.plugin.initializeAdditionalRepos();
				}));

		// Token settings
		new Setting(repoContainer)
			.setName('Use main token')
			.setDesc('Use the same token as the main repository')
			.addToggle(toggle => toggle
				.setValue(repoConfig.useMainToken)
				.onChange(async (value) => {
					repoConfig.useMainToken = value;
					await this.plugin.saveSettings();
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
					this.display();
				}));

		if (!repoConfig.useMainToken) {
			new Setting(repoContainer)
				.setName('Personal access token')
				.addText(text => {
					text.inputEl.type = 'password';
					text
						.setPlaceholder('Paste token here')
						.setValue(repoConfig.token)
						.onChange(async (value) => {
							repoConfig.token = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// Subfolder path
		new Setting(repoContainer)
			.setName('Subfolder path')
			.setDesc('Optional: sync a subfolder of the remote repo')
			.addText(text => text
				.setPlaceholder('E.g., docs/notes')
				.setValue(repoConfig.subfolderPath)
				.onChange(async (value) => {
					repoConfig.subfolderPath = value.trim();
					await this.plugin.saveSettings();
				}));
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

	private renderIgnorePatternsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Ignore patterns').setHeading();
		new Setting(containerEl)
			.setDesc(`Files matching these patterns will be excluded from sync. Use glob patterns (e.g., "*.tmp", "${this.plugin.app.vault.configDir}/workspace.json").`);

		const patternsContainer = containerEl.createDiv({ cls: 'github-octokit-ignore-patterns' });

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
							this.plugin.getMainRepoIgnorePatterns(),
							this.plugin.settings.subfolderPath,
							this.plugin.settings.syncConfiguration
						);
						// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
						this.display();
					}));
		});

		new Setting(containerEl)
			.setName('Add pattern')
			.setDesc('Add a new ignore pattern')
			.addText(text => text
				.setPlaceholder(`${this.plugin.app.vault.configDir}/cache/**`)
				.onChange(() => {}))
			.addButton(button => button
				.setButtonText('Add')
				.onClick(async () => {
					const input = containerEl.querySelector('.github-octokit-ignore-patterns + .setting-item input') as HTMLInputElement;
					const value = input?.value?.trim();
					if (value && !this.plugin.settings.ignorePatterns.includes(value)) {
						this.plugin.settings.ignorePatterns.push(value);
						await this.plugin.saveSettings();
						this.plugin.syncService.configure(
							this.plugin.getMainRepoIgnorePatterns(),
							this.plugin.settings.subfolderPath,
							this.plugin.settings.syncConfiguration
						);
						// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
						this.display();
					}
				}));
	}

	private renderSyncTriggersSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Sync behavior').setHeading();

		const configDir = this.plugin.app.vault.configDir;
		new Setting(containerEl)
			.setName('Sync configuration folder')
			.setDesc(`Include the ${configDir} folder in sync. When disabled, all configuration files are excluded.`)
			.addToggle(toggle => toggle
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

		new Setting(containerEl)
			.setDesc('Choose when the plugin should automatically sync with GitHub. Enable multiple triggers as needed.');

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
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: migrate to getSettingDefinitions
					this.display();
				}));

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
	}

	private renderCommitSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Commit messages').setHeading();

		new Setting(containerEl)
			.setName('Commit message template')
			.setDesc('Template for commit messages. Use {date}, {files}, {action}')
			.addText(text => text
				.setPlaceholder('Vault sync: {date}')
				.setValue(this.plugin.settings.commitConfig.messageTemplate)
				.onChange(async (value) => {
					this.plugin.settings.commitConfig.messageTemplate = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderConflictSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Conflict resolution').setHeading();

		new Setting(containerEl)
			.setName('Default resolution')
			.setDesc('How to handle conflicts when the same file is changed locally and remotely')
			.addDropdown(dropdown => dropdown
				.addOption('manual', 'Ask me each time')
				.addOption('keep-local', 'Keep local version')
				.addOption('keep-remote', 'Keep remote version')
				.addOption('keep-both', 'Keep both (rename)')
				.setValue(this.plugin.settings.defaultConflictResolution)
				.onChange(async (value: string) => {
					this.plugin.settings.defaultConflictResolution = value as ConflictResolution;
					await this.plugin.saveSettings();
				}));
	}

	private renderUISection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('UI preferences').setHeading();

		new Setting(containerEl)
			.setName('Show status bar')
			.setDesc('Show sync status in the status bar')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showStatusBar)
				.onChange(async (value) => {
					this.plugin.settings.showStatusBar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show notifications')
			.setDesc('Show notifications for sync events')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showNotifications)
				.onChange(async (value) => {
					this.plugin.settings.showNotifications = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderLoggingSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Logging').setHeading();

		new Setting(containerEl)
			.setName('Enable logging')
			.setDesc('Log sync operations for debugging')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.logging.enabled)
				.onChange(async (value) => {
					this.plugin.settings.logging.enabled = value;
					this.plugin.logger.configure({ enabled: value });
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Log level')
			.setDesc('Minimum log level to record')
			.addDropdown(dropdown => dropdown
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

		new Setting(containerEl)
			.setName('Persist logs to file')
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
				.setName('Log file path')
				.setDesc('Path for the log file (relative to vault root)')
				.addText(text => text
					.setPlaceholder('Enter log file path')
					.setValue(this.plugin.settings.logging.logFilePath)
					.onChange(async (value) => {
						this.plugin.settings.logging.logFilePath = value || '.github-sync.log';
						this.plugin.logger.configure({ logFilePath: value || '.github-sync.log' });
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('View logs')
			.setDesc('View recent log entries')
			.addButton(button => button
				.setButtonText('View logs')
				.onClick(() => {
					new LogViewerModal(this.app, this.plugin.logger).open();
				}));

		new Setting(containerEl)
			.setName('Clear logs')
			.setDesc('Clear all log entries from memory')
			.addButton(button => button
				.setButtonText('Clear')
				// eslint-disable-next-line @typescript-eslint/no-deprecated -- setDestructive requires minAppVersion 1.13.0
				.setWarning()
				.onClick(() => {
					this.plugin.logger.clear();
					new Notice('Logs cleared');
				}));
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

