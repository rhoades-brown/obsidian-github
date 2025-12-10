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
		containerEl.createEl('h2', { text: 'Repository' });

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
	}

	private renderIgnorePatternsSection(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: 'Ignore Patterns' });
		containerEl.createEl('p', {
			text: 'Files matching these patterns will be excluded from sync. Use glob patterns (e.g., "*.tmp", ".obsidian/workspace.json").',
			cls: 'setting-item-description'
		});

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
			.setName('Add Pattern')
			.setDesc('Add a new ignore pattern')
			.addText(text => text
				.setPlaceholder('.obsidian/cache/**')
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
	}

	private renderConflictSection(containerEl: HTMLElement): void {
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
	}

	private renderUISection(containerEl: HTMLElement): void {
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

	private renderLoggingSection(containerEl: HTMLElement): void {
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

