// Mock Obsidian module for testing

export class App {
    vault = new Vault();
    workspace = new Workspace();
}

export class Vault {
    private files: Map<string, string> = new Map();

    async read(file: TFile): Promise<string> {
        return this.files.get(file.path) || '';
    }

    async create(path: string, content: string): Promise<TFile> {
        this.files.set(path, content);
        return new TFile(path);
    }

    async modify(file: TFile, content: string): Promise<void> {
        this.files.set(file.path, content);
    }

    async delete(file: TFile): Promise<void> {
        this.files.delete(file.path);
    }

    getAbstractFileByPath(path: string): TAbstractFile | null {
        if (this.files.has(path)) {
            return new TFile(path);
        }
        return null;
    }

    getFiles(): TFile[] {
        return Array.from(this.files.keys()).map(p => new TFile(p));
    }

    async createFolder(path: string): Promise<void> {
        // Mock folder creation
    }
}

export class Workspace {
    getLeaf(): WorkspaceLeaf {
        return new WorkspaceLeaf();
    }

    getLeavesOfType(_type: string): WorkspaceLeaf[] {
        return [];
    }

    getRightLeaf(_split: boolean): WorkspaceLeaf | null {
        return new WorkspaceLeaf();
    }

    revealLeaf(_leaf: WorkspaceLeaf): void {}
}

export class WorkspaceLeaf {
    view: ItemView | null = null;

    async setViewState(_state: any): Promise<void> {}
}

export abstract class ItemView {
    containerEl: HTMLElement = document.createElement('div');
    
    constructor(public leaf: WorkspaceLeaf) {}
    
    abstract getViewType(): string;
    abstract getDisplayText(): string;
    
    getIcon(): string { return 'document'; }
    async onOpen(): Promise<void> {}
    async onClose(): Promise<void> {}
}

export class TAbstractFile {
    path: string;
    name: string;
    
    constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() || path;
    }
}

export class TFile extends TAbstractFile {
    extension: string;
    
    constructor(path: string) {
        super(path);
        this.extension = path.split('.').pop() || '';
    }
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
}

export class Notice {
    constructor(public message: string, public timeout?: number) {}
    hide(): void {}
}

export class Plugin {
    app: App = new App();
    manifest: any = {};
    
    async loadData(): Promise<any> { return {}; }
    async saveData(_data: any): Promise<void> {}
    addCommand(_command: any): void {}
    addRibbonIcon(_icon: string, _title: string, _callback: Function): HTMLElement {
        return document.createElement('div');
    }
    addStatusBarItem(): HTMLElement {
        return document.createElement('div');
    }
    addSettingTab(_tab: any): void {}
    registerView(_type: string, _creator: Function): void {}
    registerEvent(_event: any): void {}
}

export class PluginSettingTab {
    containerEl: HTMLElement = document.createElement('div');
    constructor(public app: App, public plugin: Plugin) {}
    display(): void {}
    hide(): void {}
}

export class Setting {
    constructor(public containerEl: HTMLElement) {}
    setName(_name: string): this { return this; }
    setDesc(_desc: string): this { return this; }
    addText(_cb: Function): this { return this; }
    addTextArea(_cb: Function): this { return this; }
    addToggle(_cb: Function): this { return this; }
    addDropdown(_cb: Function): this { return this; }
    addSlider(_cb: Function): this { return this; }
    addButton(_cb: Function): this { return this; }
}

export class Modal {
    contentEl: HTMLElement = document.createElement('div');
    constructor(public app: App) {}
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
}

