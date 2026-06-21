import { execFile as execFileCb, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

const GITHUB_USER = "kadel";
const ROOT_CATALOG_FILE = "catalog-info.yaml";

interface Defaults {
  owner: string;
}

interface Config {
  defaults: Defaults;
}

/** A Backstage catalog entity, parsed loosely from YAML. */
interface Entity {
  kind?: string;
  name?: string;
  projectSlug?: string;
  owner?: string;
}

interface RepoMetadata {
  name: string;
  isArchived: boolean;
  isFork: boolean;
}

type Status = "ok-root" | "ok-local" | "missing" | "owner-mismatch" | "no-owner";

interface ValidationResult {
  repo: string;
  status: Status;
  source: "root" | "local" | "none";
  owner?: string;
  detail?: string;
}

function exec(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Returns the indented block beneath a top-level `key:` line, i.e. all
 * following lines that are more deeply indented than the key itself.
 */
function topLevelSection(doc: string, key: string): string {
  const lines = doc.split("\n");
  const out: string[] = [];
  let inSection = false;
  const keyRe = new RegExp(`^${key}:\\s*$`);
  for (const line of lines) {
    if (/^\S/.test(line)) {
      // Reached another top-level key; stop if we were inside the section.
      if (inSection) break;
      inSection = keyRe.test(line);
      continue;
    }
    if (inSection) out.push(line);
  }
  return out.join("\n");
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? unquote(m[1]) : undefined;
}

/** Parse a single YAML document into a loose Entity. */
function parseDoc(doc: string): Entity | null {
  const kind = firstMatch(doc, /^kind:\s*(.+)$/m);
  if (!kind) return null;

  const metadata = topLevelSection(doc, "metadata");
  const spec = topLevelSection(doc, "spec");

  return {
    kind,
    name: firstMatch(metadata, /^\s+name:\s*(.+?)\s*$/m),
    projectSlug: firstMatch(doc, /github\.com\/project-slug:\s*(.+?)\s*$/m),
    owner: firstMatch(spec, /^\s+owner:\s*(.+?)\s*$/m),
  };
}

/** Split a (possibly multi-document) YAML string into entities. */
function parseEntities(text: string): Entity[] {
  return text
    .split(/^---\s*$/m)
    .map((doc) => doc.trim())
    .filter(Boolean)
    .map(parseDoc)
    .filter((e): e is Entity => e !== null);
}

/** The repo name an entity records, if it maps to one. */
function entityRepo(e: Entity): string | undefined {
  if (e.projectSlug) {
    const [owner, repo] = e.projectSlug.split("/");
    if (owner === GITHUB_USER && repo) return repo;
  }
  // A bare Component with no slug is taken to record the repo of the same name.
  if (e.kind === "Component" && e.name) return e.name;
  return undefined;
}

/** Fetch non-forked repos for the user. */
function fetchRepos(includeArchived: boolean): RepoMetadata[] {
  const json = exec("gh", [
    "repo", "list", GITHUB_USER,
    "--source", "--limit", "500",
    "--json", "name,isArchived,isFork",
  ]);
  const repos: RepoMetadata[] = JSON.parse(json);
  return repos.filter((r) => !r.isFork && (includeArchived || !r.isArchived));
}

/** Raw contents of the repo-root catalog-info.yaml, or null if absent. */
async function fetchRootCatalog(repo: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${GITHUB_USER}/${repo}/contents/${ROOT_CATALOG_FILE}`,
        "-H", "Accept: application/vnd.github.raw",
      ],
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    // 404 (no file) or any other error → treat as absent.
    return null;
  }
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Load every Component-like local record keyed by repo name. */
function loadLocalRecords(dir: string): Map<string, Entity> {
  const byRepo = new Map<string, Entity>();
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf-8");
    for (const entity of parseEntities(text)) {
      const repo = entityRepo(entity);
      if (repo) byRepo.set(repo, entity);
    }
  }
  return byRepo;
}

function validateOwner(
  repo: string,
  source: "root" | "local",
  owner: string | undefined,
  expectedOwner: string,
): ValidationResult {
  if (!owner) {
    return { repo, status: "no-owner", source, detail: "spec.owner is missing" };
  }
  if (owner !== expectedOwner) {
    return {
      repo,
      status: "owner-mismatch",
      source,
      owner,
      detail: `owner is '${owner}', expected '${expectedOwner}'`,
    };
  }
  return { repo, status: source === "root" ? "ok-root" : "ok-local", source, owner };
}

function printSummary(results: ValidationResult[]) {
  const nameWidth = Math.max(24, ...results.map((r) => r.repo.length + 2));
  const line = "=".repeat(nameWidth + 50);

  console.log("\n" + line);
  console.log("REPO".padEnd(nameWidth) + "SOURCE".padEnd(10) + "STATUS".padEnd(18) + "DETAIL");
  console.log(line);

  // Failures first, then OK, each alphabetical.
  const rank = (s: Status) => (s === "ok-root" || s === "ok-local" ? 1 : 0);
  const sorted = [...results].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.repo.localeCompare(b.repo),
  );

  for (const r of sorted) {
    console.log(
      r.repo.padEnd(nameWidth) +
        r.source.padEnd(10) +
        r.status.padEnd(18) +
        (r.detail ?? ""),
    );
  }

  console.log(line);
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Total: ${results.length} | ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | "),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "include-archived": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  try {
    exec("which", ["gh"]);
  } catch {
    console.error("Error: 'gh' is not installed or not in PATH");
    process.exit(1);
  }

  const config: Config = JSON.parse(
    readFileSync(join(__dirname, "repo-config.json"), "utf-8"),
  );
  const expectedOwner = config.defaults.owner;

  const localRecords = loadLocalRecords(__dirname);

  console.error("Fetching repository list from GitHub...");
  let repos = fetchRepos(values["include-archived"]!);
  if (values.repo) {
    repos = repos.filter((r) => r.name === values.repo);
    if (repos.length === 0) {
      console.error(`Error: non-forked repo '${values.repo}' not found for ${GITHUB_USER}`);
      process.exit(1);
    }
  }
  console.error(`Validating ${repos.length} non-forked repositories...`);

  const results = await mapPool(repos, 8, async (repo): Promise<ValidationResult> => {
    const rootContent = await fetchRootCatalog(repo.name);
    if (rootContent !== null) {
      const entities = parseEntities(rootContent);
      const match = entities.find((e) => entityRepo(e) === repo.name) ?? entities[0];
      return validateOwner(repo.name, "root", match?.owner, expectedOwner);
    }

    const local = localRecords.get(repo.name);
    if (local) {
      return validateOwner(repo.name, "local", local.owner, expectedOwner);
    }

    return {
      repo: repo.name,
      status: "missing",
      source: "none",
      detail: `no ${ROOT_CATALOG_FILE} in repo root and no local record`,
    };
  });

  if (values.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printSummary(results);
  }

  const failed = results.filter((r) => r.status !== "ok-root" && r.status !== "ok-local");
  if (failed.length > 0) {
    console.error(`\n${failed.length} repositor${failed.length === 1 ? "y" : "ies"} failed validation.`);
    process.exit(1);
  }
  console.error("\nAll repositories valid.");
}

main();
