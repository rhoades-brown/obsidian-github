import { App, Modal } from 'obsidian';

/**
 * Simple sync modal (placeholder for future enhancements)
 */
export class SyncModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
		contentEl.setText('GitHub Octokit sync');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

