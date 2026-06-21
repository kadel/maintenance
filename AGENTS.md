# Maintenance Scripts

This repository contains scripts for maintaining GitHub repositories and profile for the `kadel` GitHub account.

## Project Structure

- `catalog-info/` — Backstage catalog-info validator
  - `validate-catalog.ts` — Main script (TypeScript, zero runtime deps)
  - `repo-config.json` — Holds `defaults.owner` (the expected owner for all entities)
  - `systems.yaml` — Backstage System entity definitions
  - Any `*.yaml` here is scanned for local component records (e.g. `deprecated-components.yaml`)

## Key Commands

```bash
npm run catalog:validate                 # Validate all non-forked repos
npm run catalog:validate -- --repo NAME  # Validate a single repo
npm run catalog:validate -- --include-archived
npm run catalog:validate -- --json       # Machine-readable output
```

## How the Catalog Validator Works

- Fetches all non-forked repos for the `kadel` account via the `gh` CLI
- For each repo, it must be covered either by:
  - a `catalog-info.yaml` in the repo root on GitHub, or
  - a local record in `catalog-info/` (a `Component` entity, or any entity whose
    `github.com/project-slug` annotation points at the repo)
- Validates that each covered entity's `spec.owner` matches `defaults.owner`
  from `repo-config.json`
- Reports `missing`, `owner-mismatch`, or `no-owner` failures and exits non-zero
  if any repo fails; archived repos are skipped unless `--include-archived`

## Tech Stack

- TypeScript with `tsx` (dev dependency only)
- Zero runtime dependencies — shells out to `gh`; bounded-concurrency API calls
- `node:util` parseArgs for CLI
