import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { GitHubRepo } from '../services/githubService';
import { LogLevel } from '../services/loggerService';
import { ConflictResolution } from '../types/settings';
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- product name and menu paths
			.setDesc('GitHub PAT with repo access. Create one at GitHub → Settings → Developer settings → Personal access tokens')
			.addText(text => {
				text
					.setPlaceholder('ghp_xxxxxxxxxxxx')  // eslint-disable-line obsidianmd/ui/sentence-case
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
			.setDesc('Optional: Sync vault to a subfolder in the repo (e.g., "notes/obsidian")')
			.addText(text => text
				.setPlaceholder('/')
				.setValue(this.plugin.settings.subfolderPath)
				.onChange(async (value) => {
					this.plugin.settings.subfolderPath = value;
					await this.plugin.saveSettings();
				}));
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
							this.plugin.settings.ignorePatterns,
							this.plugin.settings.subfolderPath
						);
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
							this.plugin.settings.ignorePatterns,
							this.plugin.settings.subfolderPath
						);
						this.display();
					}
				}));
	}

	private renderSyncTriggersSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Sync triggers').setHeading();
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
		// eslint-disable-next-line obsidianmd/settings-tab/no-problematic-settings-headings -- false positive, says "options" not "settings"
		new Setting(containerEl).setName('Commit options').setHeading();

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
				.onChange(async (value: ConflictResolution) => {
					this.plugin.settings.defaultConflictResolution = value;
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
				.onChange(async (value: LogLevel) => {
					this.plugin.settings.logging.level = value;
					this.plugin.logger.configure({ level: value });
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
					.setPlaceholder('.github-sync.log')  // eslint-disable-line obsidianmd/ui/sentence-case
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
			containerEl.createEl('div', {
				text: `✅ Connected as ${user?.login}`,
				cls: 'github-octokit-status-connected',
			});
		} else if (this.plugin.settings.auth.token) {
			containerEl.createEl('div', {
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- "Connect" is button name
				text: '⚠️ Token saved but not validated. Click Connect to verify.',
				cls: 'github-octokit-status-pending',
			});
		} else {
			containerEl.createEl('div', {
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- status message
				text: '❌ Not connected. Enter a personal access token to connect.',
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

