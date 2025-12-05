import {
    normalizePath,
    joinPath,
    getExtension,
    getParentPath,
    getFilename,
    hashContent,
    matchesIgnorePattern,
    filterIgnoredFiles,
    encodeBase64,
    decodeBase64,
    isBinaryFile,
} from '../../src/utils/fileUtils';

describe('Path Utilities', () => {
    describe('normalizePath', () => {
        it('should convert backslashes to forward slashes', () => {
            expect(normalizePath('path\\to\\file.md')).toBe('path/to/file.md');
        });

        it('should remove leading slashes', () => {
            expect(normalizePath('/path/to/file.md')).toBe('path/to/file.md');
        });

        it('should remove trailing slashes', () => {
            expect(normalizePath('path/to/folder/')).toBe('path/to/folder');
        });

        it('should collapse multiple slashes', () => {
            expect(normalizePath('path//to///file.md')).toBe('path/to/file.md');
        });

        it('should handle empty string', () => {
            expect(normalizePath('')).toBe('');
        });
    });

    describe('joinPath', () => {
        it('should join path segments', () => {
            expect(joinPath('path', 'to', 'file.md')).toBe('path/to/file.md');
        });

        it('should handle empty segments', () => {
            expect(joinPath('path', '', 'file.md')).toBe('path/file.md');
        });

        it('should handle single segment', () => {
            expect(joinPath('file.md')).toBe('file.md');
        });
    });

    describe('getExtension', () => {
        it('should return file extension', () => {
            expect(getExtension('file.md')).toBe('md');
        });

        it('should handle multiple dots', () => {
            expect(getExtension('file.test.ts')).toBe('ts');
        });

        it('should return empty for no extension', () => {
            expect(getExtension('README')).toBe('');
        });

        it('should handle hidden files', () => {
            // Hidden files without extension return empty
            expect(getExtension('.gitignore')).toBe('');
        });
    });

    describe('getParentPath', () => {
        it('should return parent directory', () => {
            expect(getParentPath('path/to/file.md')).toBe('path/to');
        });

        it('should return empty for root file', () => {
            expect(getParentPath('file.md')).toBe('');
        });

        it('should handle trailing slash', () => {
            expect(getParentPath('path/to/folder/')).toBe('path/to');
        });
    });

    describe('getFilename', () => {
        it('should return filename', () => {
            expect(getFilename('path/to/file.md')).toBe('file.md');
        });

        it('should handle root file', () => {
            expect(getFilename('file.md')).toBe('file.md');
        });
    });
});

describe('Hash Utilities', () => {
    describe('hashContent', () => {
        it('should return consistent hash for same content', () => {
            const hash1 = hashContent('test content');
            const hash2 = hashContent('test content');
            expect(hash1).toBe(hash2);
        });

        it('should return different hash for different content', () => {
            const hash1 = hashContent('content 1');
            const hash2 = hashContent('content 2');
            expect(hash1).not.toBe(hash2);
        });

        it('should handle empty string', () => {
            const hash = hashContent('');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });
    });
});

describe('Ignore Pattern Utilities', () => {
    describe('matchesIgnorePattern', () => {
        it('should match exact filename', () => {
            // matchesIgnorePattern takes an array of patterns
            expect(matchesIgnorePattern('file.md', ['file.md'])).toBe(true);
        });

        it('should match wildcard pattern', () => {
            expect(matchesIgnorePattern('file.md', ['*.md'])).toBe(true);
            expect(matchesIgnorePattern('file.txt', ['*.md'])).toBe(false);
        });

        it('should match double wildcard for directories', () => {
            expect(matchesIgnorePattern('path/to/file.md', ['**/file.md'])).toBe(true);
        });

        it('should match directory patterns', () => {
            expect(matchesIgnorePattern('.obsidian/config', ['.obsidian/**'])).toBe(true);
        });

        it('should return false for no matching patterns', () => {
            expect(matchesIgnorePattern('file.md', ['*.txt', '*.js'])).toBe(false);
        });
    });

    describe('filterIgnoredFiles', () => {
        // filterIgnoredFiles expects TFile objects, test at integration level
        it('should be tested with TFile objects', () => {
            // This is tested at integration level since it requires TFile
            expect(typeof filterIgnoredFiles).toBe('function');
        });
    });
});

