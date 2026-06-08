# Maintenance Scripts

This repository contains scripts for maintaining GitHub repositories and profile for the `kadel` GitHub account.

## Project Structure

- `catalog-info/` — Backstage catalog-info.yaml generator
  - `generate-catalog.ts` — Main script (TypeScript, zero runtime deps)
  - `repo-config.json` — Per-repo config mapping repos to Backstage systems
  - `systems.yaml` — Backstage System entity definitions
  - `deprecated-components.yaml` — Generated file with entities for deprecated repos

## Key Commands

```bash
npm run catalog          # Dry run
npm run catalog:apply    # Apply without pushing
npm run catalog:push     # Apply and push to repos
```

## How the Catalog Generator Works

- Reads `repo-config.json` for system/type/tag assignments
- Fetches repo metadata from GitHub API via `gh` CLI
- Active repos: pushes `catalog-info.yaml` into each repo
- Deprecated repos (inactive 5+ years): writes entities to local `deprecated-components.yaml`
- Always overwrites existing `catalog-info.yaml` files

## Tech Stack

- TypeScript with `tsx` (dev dependency only)
- Zero runtime dependencies — shells out to `gh` and `git`
- `node:util` parseArgs for CLI
