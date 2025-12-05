/**
 * Diff utilities for comparing file content
 */

export interface DiffLine {
    type: 'unchanged' | 'added' | 'removed' | 'context';
    content: string;
    oldLineNumber: number | null;
    newLineNumber: number | null;
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
}

export interface DiffResult {
    oldContent: string;
    newContent: string;
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
    hasChanges: boolean;
}

/**
 * Compute the longest common subsequence between two arrays of lines
 */
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp;
}

/**
 * Backtrack through the LCS table to get the diff
 */
function backtrackDiff(dp: number[][], oldLines: string[], newLines: string[]): DiffLine[] {
    let i = oldLines.length;
    let j = newLines.length;
    let oldLine = i;
    let newLine = j;
    const pending: DiffLine[] = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            pending.unshift({
                type: 'unchanged', content: oldLines[i - 1],
                oldLineNumber: oldLine, newLineNumber: newLine,
            });
            i--; j--; oldLine--; newLine--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            pending.unshift({
                type: 'added', content: newLines[j - 1],
                oldLineNumber: null, newLineNumber: newLine,
            });
            j--; newLine--;
        } else if (i > 0) {
            pending.unshift({
                type: 'removed', content: oldLines[i - 1],
                oldLineNumber: oldLine, newLineNumber: null,
            });
            i--; oldLine--;
        }
    }

    return pending;
}

/**
 * Group diff lines into hunks with context
 */
function createHunks(lines: DiffLine[], contextLines: number = 3): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let unchangedBuffer: DiffLine[] = [];

    for (const line of lines) {
        if (line.type === 'unchanged') {
            unchangedBuffer.push(line);
            if (unchangedBuffer.length > contextLines * 2 && currentHunk) {
                for (let j = 0; j < Math.min(contextLines, unchangedBuffer.length); j++) {
                    currentHunk.lines.push({ ...unchangedBuffer[j], type: 'context' });
                }
                hunks.push(currentHunk);
                currentHunk = null;
                unchangedBuffer = unchangedBuffer.slice(-contextLines);
            }
        } else {
            if (!currentHunk) {
                const leadingContext = unchangedBuffer.slice(-contextLines);
                const firstOldLine = leadingContext.length > 0
                    ? (leadingContext[0].oldLineNumber || 1) : (line.oldLineNumber || 1);
                const firstNewLine = leadingContext.length > 0
                    ? (leadingContext[0].newLineNumber || 1) : (line.newLineNumber || 1);
                currentHunk = {
                    oldStart: firstOldLine, oldLines: 0,
                    newStart: firstNewLine, newLines: 0,
                    lines: leadingContext.map(l => ({ ...l, type: 'context' as const })),
                };
            } else {
                for (const ul of unchangedBuffer) {
                    currentHunk.lines.push({ ...ul, type: 'context' });
                }
            }
            unchangedBuffer = [];
            currentHunk.lines.push(line);
        }
    }

    if (currentHunk) {
        for (let j = 0; j < Math.min(contextLines, unchangedBuffer.length); j++) {
            currentHunk.lines.push({ ...unchangedBuffer[j], type: 'context' });
        }
        hunks.push(currentHunk);
    }

    for (const hunk of hunks) {
        hunk.oldLines = hunk.lines.filter(l => l.type !== 'added').length;
        hunk.newLines = hunk.lines.filter(l => l.type !== 'removed').length;
    }

    return hunks;
}


/**
 * Compute diff between two strings
 */
export function computeDiff(oldContent: string, newContent: string): DiffResult {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const dp = computeLCS(oldLines, newLines);
    const diffLines = backtrackDiff(dp, oldLines, newLines);
    const hunks = createHunks(diffLines);

    const additions = diffLines.filter(l => l.type === 'added').length;
    const deletions = diffLines.filter(l => l.type === 'removed').length;

    return {
        oldContent,
        newContent,
        hunks,
        additions,
        deletions,
        hasChanges: additions > 0 || deletions > 0,
    };
}

/**
 * Render diff as unified diff format
 */
export function renderUnifiedDiff(diff: DiffResult, filename: string): string {
    const lines: string[] = [`--- a/${filename}`, `+++ b/${filename}`];

    for (const hunk of diff.hunks) {
        lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
        for (const line of hunk.lines) {
            switch (line.type) {
                case 'added': lines.push(`+${line.content}`); break;
                case 'removed': lines.push(`-${line.content}`); break;
                default: lines.push(` ${line.content}`);
            }
        }
    }

    return lines.join('\n');
}

/**
 * Apply changes from a diff to the old content (keep new content)
 */
export function applyDiff(oldContent: string, changes: DiffLine[]): string {
    const result: string[] = [];
    for (const line of changes) {
        if (line.type !== 'removed') {
            result.push(line.content);
        }
    }
    return result.join('\n');
}

/**
 * Get a summary of changes
 */
export function getDiffSummary(diff: DiffResult): string {
    if (!diff.hasChanges) return 'No changes';
    const parts: string[] = [];
    if (diff.additions > 0) parts.push(`+${diff.additions}`);
    if (diff.deletions > 0) parts.push(`-${diff.deletions}`);
    return parts.join(' ');
}

/**
 * Get all diff lines from a diff result
 */
export function getAllDiffLines(diff: DiffResult): DiffLine[] {
    const lines: DiffLine[] = [];
    for (const hunk of diff.hunks) {
        lines.push(...hunk.lines);
    }
    return lines;
}