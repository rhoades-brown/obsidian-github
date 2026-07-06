import { App } from 'obsidian';
import { SyncView } from '../../src/views/SyncView';

describe('SyncView - Branch-aware remote reads', () => {
    it('passes the configured branch when loading remote content for diff', async () => {
        const app = new App();
        const githubService = {
            getFileContent: jest.fn().mockResolvedValue({
                path: 'notes/branch-only.md',
                sha: 'remote-sha',
                content: Buffer.from('branch content', 'utf8').toString('base64'),
                encoding: 'base64',
                size: 14,
            }),
        };

        const plugin = {
            app,
            settings: {
                repo: {
                    owner: 'octo',
                    name: 'branch-repo',
                    branch: 'feature/sync-target',
                },
            },
            githubService,
            openDiffView: jest.fn().mockResolvedValue(null),
        };

        const view = Object.create(SyncView.prototype) as SyncView & {
            app: App;
            plugin: typeof plugin;
        };
        view.app = app;
        view.plugin = plugin;

        await view['openFileDiff']('notes/branch-only.md');

        expect(githubService.getFileContent).toHaveBeenCalledWith(
            'octo',
            'branch-repo',
            'notes/branch-only.md',
            'feature/sync-target'
        );
    });
});
