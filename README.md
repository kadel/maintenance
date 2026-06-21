# maintenance

Scripts to maintain GitHub repositories and profile.

## catalog-info

Validates that every GitHub repository is registered in [Backstage](https://backstage.io/).

For each **non-forked** repository on the `kadel` account, it requires that the repo is covered by either:

- a `catalog-info.yaml` in the **repo root** on GitHub, or
- a **local record** in `catalog-info/` — a `Component` entity (or any entity whose `github.com/project-slug` annotation points at the repo) in any `*.yaml` file there. Use this for deprecated/archived repos you don't want to necrobump with a commit.

It also checks that each covered entity's `spec.owner` matches the expected owner. The command exits non-zero if any repo fails, so it can be used in CI.

### Setup

```bash
npm install
```

Requires `gh` (GitHub CLI) to be installed and authenticated.

With Nix, no setup is needed — `nix run` provides `node` and `gh` and executes
the validator directly (it uses Node's native TypeScript stripping, so there is
no `npm install` step):

```bash
nix run .                       # or: nix run github:kadel/maintenance
nix run . -- --repo ccwatch
```

### Usage

```bash
# Validate all non-forked repos
npm run catalog:validate          # or: nix run .

# Validate a single repo
npm run catalog:validate -- --repo ccwatch

# Include archived repos (skipped by default)
npm run catalog:validate -- --include-archived

# Machine-readable output
npm run catalog:validate -- --json
```

All flags work the same way after `nix run . --`, e.g. `nix run . -- --json`.

Each repo is reported with one of the following statuses:

| Status | Meaning |
| --- | --- |
| `ok-root` | Covered by a `catalog-info.yaml` in the repo root |
| `ok-local` | Covered by a local record in `catalog-info/` |
| `missing` | No root file and no local record — **fails** |
| `owner-mismatch` | `spec.owner` differs from the expected owner — **fails** |
| `no-owner` | Catalog entity has no `spec.owner` — **fails** |

### Configuration

- **`catalog-info/repo-config.json`** — `defaults.owner` is the expected owner that every catalog entity's `spec.owner` is checked against.
- **`catalog-info/systems.yaml`** — Backstage System entity definitions. Register as a Location in Backstage.
- **`catalog-info/*.yaml`** — Any YAML file here is scanned for local Component records (e.g. `deprecated-components.yaml`). Register these as Locations in Backstage alongside `systems.yaml`.
