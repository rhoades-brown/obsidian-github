import { App, Modal, Notice } from 'obsidian';
import { LoggerService } from '../../services/loggerService';

/**
 * Modal for viewing logs
 */
export class LogViewerModal extends Modal {
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

