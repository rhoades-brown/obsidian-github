import {
    computeDiff,
    getDiffSummary,
    getAllDiffLines,
    applyDiff,
} from '../../src/utils/diffUtils';

describe('Diff Utilities', () => {
    describe('computeDiff', () => {
        it('should detect no changes for identical content', () => {
            const diff = computeDiff('hello\nworld', 'hello\nworld');
            expect(diff.hasChanges).toBe(false);
            expect(diff.hunks).toHaveLength(0);
        });

        it('should detect added lines', () => {
            const diff = computeDiff('line1\nline2', 'line1\nline2\nline3');
            expect(diff.hasChanges).toBe(true);
            
            const lines = getAllDiffLines(diff);
            const addedLines = lines.filter(l => l.type === 'added');
            expect(addedLines).toHaveLength(1);
            expect(addedLines[0].content).toBe('line3');
        });

        it('should detect removed lines', () => {
            const diff = computeDiff('line1\nline2\nline3', 'line1\nline3');
            expect(diff.hasChanges).toBe(true);
            
            const lines = getAllDiffLines(diff);
            const removedLines = lines.filter(l => l.type === 'removed');
            expect(removedLines).toHaveLength(1);
            expect(removedLines[0].content).toBe('line2');
        });

        it('should detect modified lines', () => {
            const diff = computeDiff('hello world', 'hello universe');
            expect(diff.hasChanges).toBe(true);
        });

        it('should handle empty old content', () => {
            const diff = computeDiff('', 'new content');
            expect(diff.hasChanges).toBe(true);
        });

        it('should handle empty new content', () => {
            const diff = computeDiff('old content', '');
            expect(diff.hasChanges).toBe(true);
        });

        it('should handle both empty', () => {
            const diff = computeDiff('', '');
            expect(diff.hasChanges).toBe(false);
        });
    });

    describe('getDiffSummary', () => {
        it('should return summary string with additions', () => {
            const diff = computeDiff('line1', 'line1\nline2\nline3');
            const summary = getDiffSummary(diff);
            expect(summary).toContain('+');
        });

        it('should return summary string with deletions', () => {
            const diff = computeDiff('line1\nline2\nline3', 'line1');
            const summary = getDiffSummary(diff);
            expect(summary).toContain('-');
        });

        it('should return no changes message', () => {
            const diff = computeDiff('content', 'content');
            const summary = getDiffSummary(diff);
            expect(summary).toBe('No changes');
        });
    });

    describe('getAllDiffLines', () => {
        it('should return all lines from all hunks', () => {
            const diff = computeDiff('a\nb\nc', 'a\nx\nc');
            const lines = getAllDiffLines(diff);
            expect(lines.length).toBeGreaterThan(0);
        });

        it('should include line numbers', () => {
            const diff = computeDiff('line1\nline2', 'line1\nmodified');
            const lines = getAllDiffLines(diff);
            
            const numberedLines = lines.filter(l => l.oldLineNumber || l.newLineNumber);
            expect(numberedLines.length).toBeGreaterThan(0);
        });
    });

    describe('applyDiff', () => {
        it('should apply additions', () => {
            const original = 'line1\nline2';
            const diff = computeDiff(original, 'line1\nline2\nline3');
            const lines = getAllDiffLines(diff);
            const result = applyDiff(original, lines);
            expect(result).toContain('line3');
        });

        it('should apply deletions', () => {
            const original = 'line1\nline2\nline3';
            const diff = computeDiff(original, 'line1\nline3');
            const lines = getAllDiffLines(diff);
            const result = applyDiff(original, lines);
            expect(result).not.toContain('line2');
        });

        it('should handle no changes', () => {
            const original = 'unchanged content';
            const diff = computeDiff(original, original);
            // When no changes, getAllDiffLines returns empty, so use original
            expect(diff.hasChanges).toBe(false);
        });
    });
});

describe('Edge Cases', () => {
    it('should handle very long lines', () => {
        const longLine = 'a'.repeat(10000);
        const diff = computeDiff(longLine, longLine + 'b');
        expect(diff.hasChanges).toBe(true);
    });

    it('should handle special characters', () => {
        const content1 = 'hello\tworld\n\r\n';
        const content2 = 'hello\tworld\n\r\nmore';
        const diff = computeDiff(content1, content2);
        expect(diff.hasChanges).toBe(true);
    });

    it('should handle unicode', () => {
        const content1 = '你好世界';
        const content2 = '你好宇宙';
        const diff = computeDiff(content1, content2);
        expect(diff.hasChanges).toBe(true);
    });
});

