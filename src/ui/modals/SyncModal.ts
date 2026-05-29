import { App, ConfirmationModal } from 'obsidian';

/**
 * Show a confirmation dialog before a destructive action.
 *
 * @param app         The Obsidian App instance
 * @param title       Heading text shown in the modal
 * @param message     Body text describing the consequences
 * @param confirmText Label for the confirm button (default: "Delete")
 * @param onConfirm   Callback invoked when the user confirms
 */
export function confirmDestructiveAction(
	app: App,
	title: string,
	message: string,
	confirmText: string,
	onConfirm: () => void,
): void {
	const modal = new ConfirmationModal(app);
	modal.titleEl.setText(title);
	modal.contentEl.createEl('p', { text: message });
	modal.addButton(btn => btn
		.setButtonText(confirmText)
		.setDestructive()
		.setCta()
		.onClick(onConfirm));
	modal.addCancelButton();
	modal.open();
}

