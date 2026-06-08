# maintenance

Scripts to maintain GitHub repositories and profile.

## catalog-info

Generates and pushes [Backstage](https://backstage.io/) `catalog-info.yaml` files into each GitHub repository.

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

# Apply — clone each repo, write catalog-info.yaml, commit (no push)
npm run catalog:apply

# Apply and push to all repos
npm run catalog:push
```

### Configuration

- **`catalog-info/repo-config.json`** — Maps each repo to a Backstage system, with optional overrides for `type`, `lifecycle`, and `tags`. Repos not updated in 5+ years are automatically marked `lifecycle: deprecated`.
- **`catalog-info/systems.yaml`** — Backstage System entity definitions. Register this file as a Location in your Backstage instance.
