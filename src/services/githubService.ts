import { Octokit } from 'octokit';

// ============================================================================
// GitHub Service - Wrapper around Octokit for GitHub API operations
// ============================================================================

/** Repository information returned from GitHub */
export interface GitHubRepo {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    isPrivate: boolean;
    url: string;
    description: string | null;
}

/** Branch information */
export interface GitHubBranch {
    name: string;
    sha: string;
    isDefault: boolean;
}

/** File/tree entry from GitHub */
export interface GitHubTreeEntry {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
}

/** File content from GitHub */
export interface GitHubFileContent {
    path: string;
    sha: string;
    content: string;
    encoding: 'base64' | 'utf-8';
    size: number;
}

/** Commit information */
export interface GitHubCommit {
    sha: string;
    message: string;
    author: string;
    date: string;
    url: string;
}

/** User information */
export interface GitHubUser {
    login: string;
    name: string | null;
    avatarUrl: string;
}

/** Rate limit information */
export interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: Date;
}

/** File change for batch commit operations */
export interface BatchFileChange {
    path: string;
    action: 'create' | 'update' | 'delete';
    content?: string;  // Base64 encoded content (not needed for delete)
    encoding?: 'base64' | 'utf-8';
}

/**
 * GitHub Service class - handles all GitHub API interactions
 */
export class GitHubService {
    private octokit: Octokit | null = null;
    private _isAuthenticated = false;
    private _user: GitHubUser | null = null;
    private _rateLimit: RateLimitInfo | null = null;

    /**
     * Initialize the service with a Personal Access Token
     */
    async authenticate(token: string): Promise<boolean> {
        if (!token) {
            this._isAuthenticated = false;
            this._user = null;
            this.octokit = null;
            return false;
        }

        try {
            this.octokit = new Octokit({ auth: token });
            
            // Validate token by fetching user info
            const { data } = await this.octokit.rest.users.getAuthenticated();
            
            this._user = {
                login: data.login,
                name: data.name,
                avatarUrl: data.avatar_url,
            };
            
            this._isAuthenticated = true;
            return true;
        } catch (error) {
            console.error('GitHub authentication failed:', error);
            this._isAuthenticated = false;
            this._user = null;
            this.octokit = null;
            return false;
        }
    }

    /**
     * Check if the service is authenticated
     */
    get isAuthenticated(): boolean {
        return this._isAuthenticated;
    }

    /**
     * Get the authenticated user
     */
    get user(): GitHubUser | null {
        return this._user;
    }

    /**
     * Get rate limit info
     */
    get rateLimit(): RateLimitInfo | null {
        return this._rateLimit;
    }

    /**
     * Ensure we have a valid Octokit instance
     */
    private ensureAuthenticated(): Octokit {
        if (!this.octokit || !this._isAuthenticated) {
            throw new Error('GitHub service is not authenticated');
        }
        return this.octokit;
    }

    /**
     * Update rate limit info from response headers
     */
    private updateRateLimit(headers: Record<string, string | undefined>): void {
        const limit = headers['x-ratelimit-limit'];
        const remaining = headers['x-ratelimit-remaining'];
        const reset = headers['x-ratelimit-reset'];

        if (limit && remaining && reset) {
            this._rateLimit = {
                limit: parseInt(limit, 10),
                remaining: parseInt(remaining, 10),
                reset: new Date(parseInt(reset, 10) * 1000),
            };
        }
    }

    /**
     * List repositories for the authenticated user
     */
    async listRepositories(): Promise<GitHubRepo[]> {
        const octokit = this.ensureAuthenticated();

        const repos: GitHubRepo[] = [];

        // Use pagination to get all repos
        for await (const response of octokit.paginate.iterator(
            octokit.rest.repos.listForAuthenticatedUser,
            { per_page: 100, sort: 'updated' }
        )) {
            for (const repo of response.data) {
                repos.push({
                    owner: repo.owner.login,
                    name: repo.name,
                    fullName: repo.full_name,
                    defaultBranch: repo.default_branch,
                    isPrivate: repo.private,
                    url: repo.html_url,
                    description: repo.description,
                });
            }
        }

        return repos;
    }

    /**
     * Get repository information
     */
    async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.repos.get({ owner, repo });

        return {
            owner: data.owner.login,
            name: data.name,
            fullName: data.full_name,
            defaultBranch: data.default_branch,
            isPrivate: data.private,
            url: data.html_url,
            description: data.description,
        };
    }

    /**
     * List branches for a repository
     */
    async listBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
        const octokit = this.ensureAuthenticated();

        const repoInfo = await this.getRepository(owner, repo);
        const branches: GitHubBranch[] = [];

        for await (const response of octokit.paginate.iterator(
            octokit.rest.repos.listBranches,
            { owner, repo, per_page: 100 }
        )) {
            for (const branch of response.data) {
                branches.push({
                    name: branch.name,
                    sha: branch.commit.sha,
                    isDefault: branch.name === repoInfo.defaultBranch,
                });
            }
        }

        return branches;
    }

    /**
     * Get the full file tree for a repository at a specific ref
     */
    async getTree(owner: string, repo: string, ref: string): Promise<GitHubTreeEntry[]> {
        const octokit = this.ensureAuthenticated();

        // First get the commit SHA for the ref
        const { data: refData } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${ref}`,
        });

        // Get the tree recursively
        const { data: treeData } = await octokit.rest.git.getTree({
            owner,
            repo,
            tree_sha: refData.object.sha,
            recursive: 'true',
        });

        type TreeEntry = {
            path?: string;
            mode?: string;
            type?: string;
            sha?: string;
            size?: number;
        };

        return (treeData.tree as TreeEntry[])
            .filter((entry: TreeEntry) => entry.path && entry.sha && entry.type)
            .map((entry: TreeEntry) => ({
                path: entry.path!,
                mode: entry.mode || '100644',
                type: entry.type as 'blob' | 'tree',
                sha: entry.sha!,
                size: entry.size,
            }));
    }

    /**
     * Get file content from the repository
     */
    async getFileContent(
        owner: string,
        repo: string,
        path: string,
        ref?: string
    ): Promise<GitHubFileContent> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref,
        });

        if (Array.isArray(data) || data.type !== 'file') {
            throw new Error(`Path is not a file: ${path}`);
        }

        return {
            path: data.path,
            sha: data.sha,
            content: data.content || '',
            encoding: (data.encoding as 'base64' | 'utf-8') || 'base64',
            size: data.size,
        };
    }

    /**
     * Create or update a file in the repository
     */
    async createOrUpdateFile(
        owner: string,
        repo: string,
        path: string,
        content: string,
        message: string,
        branch: string,
        sha?: string
    ): Promise<{ sha: string; commitSha: string }> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            message,
            content,
            branch,
            sha,
        });

        return {
            sha: data.content?.sha || '',
            commitSha: data.commit.sha,
        };
    }

    /**
     * Delete a file from the repository
     */
    async deleteFile(
        owner: string,
        repo: string,
        path: string,
        message: string,
        branch: string,
        sha: string
    ): Promise<string> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.repos.deleteFile({
            owner,
            repo,
            path,
            message,
            branch,
            sha,
        });

        return data.commit.sha;
    }

    /**
     * Get recent commits for a repository
     */
    async getCommits(
        owner: string,
        repo: string,
        branch: string,
        limit = 10
    ): Promise<GitHubCommit[]> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.repos.listCommits({
            owner,
            repo,
            sha: branch,
            per_page: limit,
        });

        type CommitData = {
            sha: string;
            html_url: string;
            commit: {
                message: string;
                author?: { name?: string; date?: string } | null;
            };
            author?: { login?: string } | null;
        };

        return (data as CommitData[]).map((commit: CommitData) => ({
            sha: commit.sha,
            message: commit.commit.message,
            author: commit.commit.author?.name || commit.author?.login || 'Unknown',
            date: commit.commit.author?.date || '',
            url: commit.html_url,
        }));
    }

    /**
     * Get the latest commit SHA for a branch
     */
    async getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.repos.getBranch({
            owner,
            repo,
            branch,
        });

        return data.commit.sha;
    }

    // ========================================================================
    // Batch Commit Support (Git Data API)
    // ========================================================================

    /**
     * Create a batch commit with multiple file changes
     * Uses the Git Data API for efficient multi-file commits
     */
    async createBatchCommit(
        owner: string,
        repo: string,
        branch: string,
        message: string,
        changes: BatchFileChange[],
        options?: { retryCount?: number }
    ): Promise<{ commitSha: string; treeSha: string }> {
        const octokit = this.ensureAuthenticated();
        const maxRetries = options?.retryCount ?? 3;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Get the current commit SHA for the branch (fresh on each attempt)
                const { data: refData } = await octokit.rest.git.getRef({
                    owner,
                    repo,
                    ref: `heads/${branch}`,
                });
                const currentCommitSha = refData.object.sha;

                // Get the current tree SHA
                const { data: commitData } = await octokit.rest.git.getCommit({
                    owner,
                    repo,
                    commit_sha: currentCommitSha,
                });
                const baseTreeSha = commitData.tree.sha;

                // Create blobs for all new/updated files
                const treeItems: Array<{
                    path: string;
                    mode: '100644' | '100755' | '040000' | '160000' | '120000';
                    type: 'blob' | 'tree' | 'commit';
                    sha?: string | null;
                }> = [];

                for (const change of changes) {
                    if (change.action === 'delete') {
                        // For deletions, we set sha to null
                        treeItems.push({
                            path: change.path,
                            mode: '100644',
                            type: 'blob',
                            sha: null,
                        });
                    } else {
                        // Create a blob for the content
                        const { data: blobData } = await octokit.rest.git.createBlob({
                            owner,
                            repo,
                            content: change.content!,
                            encoding: change.encoding || 'base64',
                        });

                        treeItems.push({
                            path: change.path,
                            mode: '100644',
                            type: 'blob',
                            sha: blobData.sha,
                        });
                    }
                }

                // Create a new tree with all changes
                const { data: newTreeData } = await octokit.rest.git.createTree({
                    owner,
                    repo,
                    base_tree: baseTreeSha,
                    tree: treeItems,
                });

                // If the new tree is the same as the base tree, no changes were made
                if (newTreeData.sha === baseTreeSha) {
                    return {
                        commitSha: currentCommitSha,
                        treeSha: baseTreeSha,
                    };
                }

                // Create the commit
                const { data: newCommitData } = await octokit.rest.git.createCommit({
                    owner,
                    repo,
                    message,
                    tree: newTreeData.sha,
                    parents: [currentCommitSha],
                });

                // Update the branch reference to point to the new commit
                await octokit.rest.git.updateRef({
                    owner,
                    repo,
                    ref: `heads/${branch}`,
                    sha: newCommitData.sha,
                    force: false,
                });

                return {
                    commitSha: newCommitData.sha,
                    treeSha: newTreeData.sha,
                };
            } catch (error) {
                const isNotFastForward = error instanceof Error &&
                    error.message.includes('Update is not a fast forward');

                if (isNotFastForward && attempt < maxRetries - 1) {
                    // Remote was updated, wait briefly and retry with fresh ref
                    console.log(`Batch commit attempt ${attempt + 1} failed (not fast-forward), retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
                    continue;
                }

                throw error;
            }
        }

        throw new Error('Batch commit failed after maximum retries');
    }

    // ========================================================================
    // Rate Limit Handling
    // ========================================================================

    /**
     * Get current rate limit status
     */
    async getRateLimitStatus(): Promise<RateLimitInfo> {
        const octokit = this.ensureAuthenticated();

        const { data } = await octokit.rest.rateLimit.get();

        this._rateLimit = {
            limit: data.resources.core.limit,
            remaining: data.resources.core.remaining,
            reset: new Date(data.resources.core.reset * 1000),
        };

        return this._rateLimit;
    }

    /**
     * Check if we have enough API calls remaining
     */
    async checkRateLimit(requiredCalls: number = 10): Promise<{
        ok: boolean;
        remaining: number;
        resetIn: number;
    }> {
        const status = await this.getRateLimitStatus();
        const resetIn = Math.max(0, status.reset.getTime() - Date.now());

        return {
            ok: status.remaining >= requiredCalls,
            remaining: status.remaining,
            resetIn: Math.ceil(resetIn / 1000 / 60), // minutes until reset
        };
    }

    /**
     * Wait for rate limit to reset if necessary
     */
    async waitForRateLimit(requiredCalls: number = 10): Promise<void> {
        const check = await this.checkRateLimit(requiredCalls);

        if (!check.ok && check.resetIn > 0) {
            console.log(`Rate limit low (${check.remaining} remaining). Waiting ${check.resetIn} minutes...`);
            await new Promise(resolve => setTimeout(resolve, check.resetIn * 60 * 1000));
        }
    }

    /**
     * Disconnect and clear authentication
     */
    disconnect(): void {
        this.octokit = null;
        this._isAuthenticated = false;
        this._user = null;
        this._rateLimit = null;
    }
}

