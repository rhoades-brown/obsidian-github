import { ItemView, WorkspaceLeaf } from 'obsidian';
import { DiffResult, DiffLine, DiffHunk, computeDiff, getDiffSummary } from '../utils/diffUtils';

export const DIFF_VIEW_TYPE = 'github-octokit-diff-view';

export interface DiffViewState {
    filename: string;
    localContent: string;
    remoteContent: string;
    mode: 'side-by-side' | 'inline';
}

export class DiffView extends ItemView {
    private state: DiffViewState | null = null;
    private diff: DiffResult | null = null;
    private currentHunkIndex = 0;
    private mode: 'side-by-side' | 'inline' = 'side-by-side';

    // Callbacks for actions
    onAcceptLocal?: () => void;
    onAcceptRemote?: () => void;
    onAcceptBoth?: () => void;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return DIFF_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.state?.filename ? `Diff: ${this.state.filename}` : 'Diff View';
    }

    getIcon(): string {
        return 'git-compare';
    }

    async onOpen(): Promise<void> {
        this.render();
        await Promise.resolve();
    }

    async onClose(): Promise<void> {
        // Cleanup
        await Promise.resolve();
    }

    /**
     * Set the diff content to display
     */
    setContent(filename: string, localContent: string, remoteContent: string): void {
        this.state = { filename, localContent, remoteContent, mode: this.mode };
        this.diff = computeDiff(remoteContent, localContent); // remote = old, local = new
        this.currentHunkIndex = 0;
        this.render();
    }

    /**
     * Toggle between side-by-side and inline modes
     */
    toggleMode(): void {
        this.mode = this.mode === 'side-by-side' ? 'inline' : 'side-by-side';
        if (this.state) this.state.mode = this.mode;
        this.render();
    }

    /**
     * Navigate to next change
     */
    nextChange(): void {
        if (this.diff && this.diff.hunks.length > 0) {
            this.currentHunkIndex = (this.currentHunkIndex + 1) % this.diff.hunks.length;
            this.scrollToHunk(this.currentHunkIndex);
        }
    }

    /**
     * Navigate to previous change
     */
    prevChange(): void {
        if (this.diff && this.diff.hunks.length > 0) {
            this.currentHunkIndex = (this.currentHunkIndex - 1 + this.diff.hunks.length) % this.diff.hunks.length;
            this.scrollToHunk(this.currentHunkIndex);
        }
    }

    private scrollToHunk(index: number): void {
        const hunkEl = this.containerEl.querySelector(`[data-hunk-index="${index}"]`);
        if (hunkEl) {
            hunkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    private render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('github-octokit-diff-view');

        if (!this.state || !this.diff) {
            container.createEl('p', { text: 'No diff to display. Select a file with changes.' });
            return;
        }

        // Header
        const header = container.createDiv({ cls: 'diff-header' });
        header.createEl('h3', { text: this.state.filename });

        const summary = header.createSpan({ cls: 'diff-summary' });
        summary.setText(getDiffSummary(this.diff));

        // Toolbar
        const toolbar = container.createDiv({ cls: 'diff-toolbar' });
        this.renderToolbar(toolbar);

        // Content
        const content = container.createDiv({ cls: 'diff-content' });
        if (this.mode === 'side-by-side') {
            this.renderSideBySide(content);
        } else {
            this.renderInline(content);
        }

        // Action buttons
        const actions = container.createDiv({ cls: 'diff-actions' });
        this.renderActions(actions);
    }

    private renderToolbar(container: HTMLElement): void {
        // Mode toggle
        const modeBtn = container.createEl('button', {
            text: this.mode === 'side-by-side' ? 'Switch to Inline' : 'Switch to Side-by-Side',
            cls: 'mod-cta',
        });
        modeBtn.addEventListener('click', () => this.toggleMode());

        // Navigation
        const prevBtn = container.createEl('button', { text: 'Previous change' });
        prevBtn.addEventListener('click', () => this.prevChange());

         
        const nextBtn = container.createEl('button', { text: 'Next →' });
        nextBtn.addEventListener('click', () => this.nextChange());

        // Hunk counter
        if (this.diff && this.diff.hunks.length > 0) {
            container.createSpan({
                text: `Change ${this.currentHunkIndex + 1} of ${this.diff.hunks.length}`,
                cls: 'diff-counter',
            });
        }
    }

    private renderSideBySide(container: HTMLElement): void {
        container.addClass('side-by-side');

        // Create split panes
        const leftPane = container.createDiv({ cls: 'diff-pane diff-left' });
        const rightPane = container.createDiv({ cls: 'diff-pane diff-right' });

        leftPane.createEl('div', { cls: 'pane-header', text: 'Remote (GitHub)' });   
        rightPane.createEl('div', { cls: 'pane-header', text: 'Local (vault)' });

        const leftContent = leftPane.createDiv({ cls: 'pane-content' });
        const rightContent = rightPane.createDiv({ cls: 'pane-content' });

        if (!this.diff) return;

        for (let hunkIdx = 0; hunkIdx < this.diff.hunks.length; hunkIdx++) {
            const hunk = this.diff.hunks[hunkIdx];
            this.renderHunkSideBySide(leftContent, rightContent, hunk, hunkIdx);
        }
    }

    private renderHunkSideBySide(left: HTMLElement, right: HTMLElement, hunk: DiffHunk, idx: number): void {
        const leftHunk = left.createDiv({ cls: 'diff-hunk', attr: { 'data-hunk-index': String(idx) } });
        const rightHunk = right.createDiv({ cls: 'diff-hunk' });

        leftHunk.createDiv({ cls: 'hunk-header', text: `@@ -${hunk.oldStart},${hunk.oldLines} @@` });
        rightHunk.createDiv({ cls: 'hunk-header', text: `@@ +${hunk.newStart},${hunk.newLines} @@` });

        for (const line of hunk.lines) {
            const leftLine = leftHunk.createDiv({ cls: `diff-line ${this.getLineClass(line, 'left')}` });
            const rightLine = rightHunk.createDiv({ cls: `diff-line ${this.getLineClass(line, 'right')}` });

            if (line.type === 'removed' || line.type === 'context' || line.type === 'unchanged') {
                leftLine.createSpan({ cls: 'line-number', text: String(line.oldLineNumber || '') });
                leftLine.createSpan({ cls: 'line-content', text: line.content });
            }

            if (line.type === 'added' || line.type === 'context' || line.type === 'unchanged') {
                rightLine.createSpan({ cls: 'line-number', text: String(line.newLineNumber || '') });
                rightLine.createSpan({ cls: 'line-content', text: line.content });
            }
        }
    }

    private renderInline(container: HTMLElement): void {
        container.addClass('inline');
        if (!this.diff) return;

        for (let hunkIdx = 0; hunkIdx < this.diff.hunks.length; hunkIdx++) {
            const hunk = this.diff.hunks[hunkIdx];
            const hunkEl = container.createDiv({ cls: 'diff-hunk', attr: { 'data-hunk-index': String(hunkIdx) } });

            hunkEl.createDiv({
                cls: 'hunk-header',
                text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
            });

            for (const line of hunk.lines) {
                const lineEl = hunkEl.createDiv({ cls: `diff-line ${this.getInlineLineClass(line)}` });
                const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                lineEl.createSpan({ cls: 'line-prefix', text: prefix });
                lineEl.createSpan({ cls: 'line-number-old', text: String(line.oldLineNumber || '') });
                lineEl.createSpan({ cls: 'line-number-new', text: String(line.newLineNumber || '') });
                lineEl.createSpan({ cls: 'line-content', text: line.content });
            }
        }
    }

    private getLineClass(line: DiffLine, side: 'left' | 'right'): string {
        if (line.type === 'removed' && side === 'left') return 'line-removed';
        if (line.type === 'added' && side === 'right') return 'line-added';
        if (line.type === 'removed' && side === 'right') return 'line-empty';
        if (line.type === 'added' && side === 'left') return 'line-empty';
        return 'line-context';
    }

    private getInlineLineClass(line: DiffLine): string {
        if (line.type === 'added') return 'line-added';
        if (line.type === 'removed') return 'line-removed';
        return 'line-context';
    }

    private renderActions(container: HTMLElement): void {
        const acceptLocalBtn = container.createEl('button', { text: 'Keep local', cls: 'mod-cta' });
        acceptLocalBtn.addEventListener('click', () => {
            if (this.onAcceptLocal) this.onAcceptLocal();
        });

        const acceptRemoteBtn = container.createEl('button', { text: 'Keep remote' });
        acceptRemoteBtn.addEventListener('click', () => {
            if (this.onAcceptRemote) this.onAcceptRemote();
        });

        const acceptBothBtn = container.createEl('button', { text: 'Keep both' });
        acceptBothBtn.addEventListener('click', () => {
            if (this.onAcceptBoth) this.onAcceptBoth();
        });
    }
}
