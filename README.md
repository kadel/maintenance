# maintenance

Scripts to maintain GitHub repositories and profile.

## catalog-info

Generates [Backstage](https://backstage.io/) `catalog-info.yaml` entries for all GitHub repositories.

- **Active repos** get `catalog-info.yaml` pushed directly into each repository.
- **Deprecated repos** (not updated in 5+ years) get their entities written to a local `deprecated-components.yaml` in this repo to avoid necrobumping old repositories with unnecessary commits.

### Setup

```bash
npm install
```

Requires `gh` (GitHub CLI) and `git` to be installed and authenticated.

### Usage

```bash
# Dry run — preview generated YAML for all repos
npm run catalog

# Dry run for a single repo
npm run catalog -- --repo ccwatch

# Apply — clone active repos, write catalog-info.yaml, commit (no push)
# Also writes deprecated-components.yaml locally
npm run catalog:apply

# Apply and push active repos
npm run catalog:push
```

### Configuration

- **`catalog-info/repo-config.json`** — Maps each repo to a Backstage system, with optional overrides for `type`, `lifecycle`, and `tags`. Repos not updated in 5+ years are automatically marked `lifecycle: deprecated`.
- **`catalog-info/systems.yaml`** — Backstage System entity definitions. Register as a Location in Backstage.
- **`catalog-info/deprecated-components.yaml`** — Generated file containing Component entities for deprecated repos. Register as a Location in Backstage alongside `systems.yaml`.
