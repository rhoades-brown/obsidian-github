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
		contentEl.setText('GitHub Octokit Sync');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

