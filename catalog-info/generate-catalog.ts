import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

const GITHUB_USER = "kadel";

interface RepoConfig {
  system: string;
  type?: string;
  lifecycle?: string;
  tags?: string[];
}

interface Config {
  defaults: {
    owner: string;
    lifecycleCutoffYears: number;
    lifecycleActive: string;
    lifecycleStale: string;
  };
  repos: Record<string, RepoConfig>;
}

interface RepoMetadata {
  name: string;
  description: string;
  pushedAt: string;
  defaultBranchRef: { name: string } | null;
  primaryLanguage: { name: string } | null;
}

function exec(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function languageToType(lang: string | null): string {
  if (!lang) return "other";
  switch (lang) {
    case "Go":
    case "Java":
    case "Python":
    case "TypeScript":
    case "JavaScript":
    case "Rust":
    case "Ruby":
    case "C#":
      return "service";
    case "HTML":
    case "CSS":
    case "SCSS":
    case "Vue":
    case "Svelte":
      return "website";
    case "Shell":
    case "Makefile":
      return "tool";
    default:
      return "other";
  }
}

function languageToTag(lang: string | null): string | null {
  if (!lang) return null;
  const map: Record<string, string> = {
    Go: "go",
    Java: "java",
    Python: "python",
    TypeScript: "typescript",
    JavaScript: "javascript",
    Rust: "rust",
    Ruby: "ruby",
    Shell: "shell",
    Vue: "vue",
    Svelte: "svelte",
    HTML: "html",
    CSS: "css",
    SCSS: "css",
    C: "c",
    "C#": "csharp",
    Lua: "lua",
    Nix: "nix",
    "Jupyter Notebook": "jupyter",
    "Go Template": "go-template",
  };
  return map[lang] ?? lang.toLowerCase().replace(/\s+/g, "-");
}

function isStale(pushedAt: string, cutoffYears: number): boolean {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - cutoffYears);
  return new Date(pushedAt) < cutoff;
}

function generateYaml(
  name: string,
  description: string,
  system: string,
  type: string,
  lifecycle: string,
  owner: string,
  tags: string[]
): string {
  const tagsBlock =
    tags.length > 0 ? `  tags:\n${tags.map((t) => `    - ${t}`).join("\n")}\n` : "";

  return `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${name}
  description: ${yamlEscape(description || "No description")}
  annotations:
    github.com/project-slug: ${GITHUB_USER}/${name}
${tagsBlock}spec:
  type: ${type}
  lifecycle: ${lifecycle}
  owner: ${owner}
  system: ${system}
`;
}

function yamlEscape(s: string): string {
  if (/[:#\[\]{}|>&*!,'"%@`]/.test(s) || s.startsWith("- ") || s.startsWith("? ")) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function fetchRepoMetadata(): RepoMetadata[] {
  const fields = "name,description,pushedAt,defaultBranchRef,primaryLanguage";
  const json = exec("gh", [
    "repo", "list", GITHUB_USER,
    "--source", "--no-archived", "--limit", "200", "--json", fields,
  ]);
  return JSON.parse(json);
}

interface ProcessResult {
  repo: string;
  system: string;
  type: string;
  lifecycle: string;
  status: "created" | "skipped" | "dry-run" | "error";
  error?: string;
}

function processRepo(
  name: string,
  repoConfig: RepoConfig,
  metadata: RepoMetadata | undefined,
  config: Config,
  opts: { apply: boolean; push: boolean; workDir: string }
): ProcessResult {
  const result: ProcessResult = {
    repo: name,
    system: repoConfig.system,
    type: "other",
    lifecycle: config.defaults.lifecycleActive,
    status: "dry-run",
  };

  const desc = metadata?.description ?? "";
  const lang = metadata?.primaryLanguage?.name ?? null;
  const pushedAt = metadata?.pushedAt ?? "";
  const defaultBranch = metadata?.defaultBranchRef?.name ?? "main";

  result.type = repoConfig.type ?? languageToType(lang);

  if (repoConfig.lifecycle) {
    result.lifecycle = repoConfig.lifecycle;
  } else if (pushedAt && isStale(pushedAt, config.defaults.lifecycleCutoffYears)) {
    result.lifecycle = config.defaults.lifecycleStale;
  } else {
    result.lifecycle = config.defaults.lifecycleActive;
  }

  const tags: string[] = [...(repoConfig.tags ?? [])];
  const langTag = languageToTag(lang);
  if (langTag && !tags.includes(langTag)) {
    tags.push(langTag);
  }

  const yaml = generateYaml(
    name,
    desc,
    repoConfig.system,
    result.type,
    result.lifecycle,
    config.defaults.owner,
    tags
  );

  if (!opts.apply) {
    console.log(`\n--- ${name} ---`);
    console.log(yaml);
    return result;
  }

  const repoDir = join(opts.workDir, name);
  try {
    exec("git", [
      "clone", "--depth", "1",
      `https://github.com/${GITHUB_USER}/${name}.git`, repoDir,
    ]);

    writeFileSync(join(repoDir, "catalog-info.yaml"), yaml);

    exec("git", ["add", "catalog-info.yaml"], repoDir);

    const diff = exec("git", ["diff", "--cached", "--name-only"], repoDir);
    if (!diff) {
      result.status = "skipped";
      return result;
    }

    exec("git", [
      "commit",
      "-m", "Add Backstage catalog-info.yaml",
      "-m", "",
      "-m", "Assisted-by: Claude Code",
    ], repoDir);

    if (opts.push) {
      exec("git", ["push", "origin", defaultBranch], repoDir);
    }

    result.status = "created";
  } catch (e) {
    result.status = "error";
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }

  return result;
}

function printSummary(results: ProcessResult[]) {
  const nameWidth = Math.max(40, ...results.map((r) => r.repo.length + 2));

  console.log("\n" + "=".repeat(nameWidth + 50));
  console.log(
    "REPO".padEnd(nameWidth) +
      "SYSTEM".padEnd(16) +
      "TYPE".padEnd(10) +
      "LIFECYCLE".padEnd(14) +
      "STATUS"
  );
  console.log("=".repeat(nameWidth + 50));

  for (const r of results) {
    const statusStr =
      r.status === "error" ? `ERROR: ${r.error?.slice(0, 40)}` : r.status;
    console.log(
      r.repo.padEnd(nameWidth) +
        r.system.padEnd(16) +
        r.type.padEnd(10) +
        r.lifecycle.padEnd(14) +
        statusStr
    );
  }

  console.log("=".repeat(nameWidth + 50));
  const counts = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log(
    `Total: ${results.length} | ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ")
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      push: { type: "boolean", default: false },
      repo: { type: "string" },
    },
    strict: true,
  });

  for (const tool of ["gh", "git"]) {
    try {
      exec("which", [tool]);
    } catch {
      console.error(`Error: '${tool}' is not installed or not in PATH`);
      process.exit(1);
    }
  }

  const configPath = join(__dirname, "repo-config.json");
  const config: Config = JSON.parse(readFileSync(configPath, "utf-8"));

  console.log("Fetching repository metadata from GitHub...");
  const allMetadata = fetchRepoMetadata();
  const metadataMap = new Map(allMetadata.map((m) => [m.name, m]));
  console.log(`Found ${allMetadata.length} repositories on GitHub.`);

  let repoNames = Object.keys(config.repos);
  if (values.repo) {
    if (!config.repos[values.repo]) {
      console.error(`Error: repo '${values.repo}' not found in config`);
      process.exit(1);
    }
    repoNames = [values.repo];
  }

  const workDir = join(tmpdir(), `backstage-catalog-gen-${process.pid}`);
  if (values.apply) {
    mkdirSync(workDir, { recursive: true });
  }

  const mode = values.apply
    ? values.push
      ? "APPLY + PUSH"
      : "APPLY (no push)"
    : "DRY RUN";
  console.log(`\nMode: ${mode}`);
  console.log(`Processing ${repoNames.length} repositories...\n`);

  const results: ProcessResult[] = [];

  for (const name of repoNames) {
    const repoConfig = config.repos[name];
    const metadata = metadataMap.get(name);

    if (!metadata) {
      console.warn(`Warning: no GitHub metadata found for '${name}', skipping`);
      results.push({
        repo: name,
        system: repoConfig.system,
        type: repoConfig.type ?? "other",
        lifecycle: "unknown",
        status: "error",
        error: "not found on GitHub",
      });
      continue;
    }

    const result = processRepo(name, repoConfig, metadata, config, {
      apply: values.apply!,
      push: values.push!,
      workDir,
    });
    results.push(result);

    if (values.push && result.status === "created") {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  if (values.apply && existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }

  printSummary(results);
}

main();
