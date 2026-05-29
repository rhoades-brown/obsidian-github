# Development

## Getting started

```bash
# Clone and install
git clone https://github.com/rhoades-brown/obsidian-github.git
cd obsidian-github
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (rebuilds on file changes)
npm run dev

# Lint
npm run lint
```

## Project structure

```text
obsidian-github/
├── main.ts              # Plugin entry point
├── src/
│   ├── services/        # Core services (GitHub API, Sync, Logger)
│   ├── views/           # UI components (DiffView, SyncView)
│   ├── ui/              # Settings tab, modals
│   └── utils/           # Utility functions (file, diff, encoding)
├── tests/               # Jest test suites
└── styles.css           # Plugin styles
```

## Conventional commits

All commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<optional scope>): <description>
```

A [husky](https://typicode.github.io/husky/) commit-msg hook validates every commit locally. Allowed types:

| Type | Purpose |
| ------ | --------- |
| `feat` | A new feature (triggers **minor** version bump) |
| `fix` | A bug fix (triggers **patch** version bump) |
| `docs` | Documentation only |
| `style` | Code style (formatting, semicolons, etc.) |
| `refactor` | Refactoring (no feature or fix) |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD changes |
| `chore` | Maintenance tasks |
| `revert` | Reverting a previous commit |

Append `!` after the type (e.g. `feat!:`) or include `BREAKING CHANGE` in the commit body to trigger a **major** version bump.

### Examples

```text
feat: add multi-repo support
fix(sync): handle empty tree response
docs: update README with versioning info
chore: update dependencies
feat!: redesign settings API
```

## Versioning & releases

Version bumping is fully automated — you never need to edit `manifest.json`, `package.json`, or `versions.json` manually.

When a PR is merged to `main`, the CI workflow:

1. Runs lint, build, and tests
2. Analyses commit messages since the last release tag
3. Determines the SemVer bump type (`major` / `minor` / `patch`)
4. Bumps the version in `manifest.json`, `package.json`, and `versions.json` via `version-bump.mjs`
5. Commits the version bump with `[skip ci]` to avoid re-triggering CI
6. Creates a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached

If no `feat:` or `fix:` commits are found since the last release, no version bump or release is created.

### Manual version bumping

If you ever need to bump the version manually (e.g. for a pre-release), you can use:

```bash
npm version patch   # 0.4.1 → 0.4.2
npm version minor   # 0.4.1 → 0.5.0
npm version major   # 0.4.1 → 1.0.0
```

This triggers the `version` script in `package.json`, which runs `version-bump.mjs` to keep all three version files in sync.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`) and lint (`npm run lint`)
5. Commit using conventional commits (`git commit -m 'feat: add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request
