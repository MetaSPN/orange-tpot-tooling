/**
 * Update-from-template: fetch a release tarball from the template repo and apply
 * template-owned files to a creator or index repo. Preserves user-owned files.
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { getTemplateRepo, getTemplateTarballUrl, TEMPLATE_DEFAULT_REF } from "./config";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Template-owned paths for creator repo (relative to templates/creator). User-owned: creator.json, posts/, metadata/ */
const CREATOR_TEMPLATE_FILES = [
  ".github/workflows/sync-posts.yml",
  ".github/workflows/update-from-template.yml",
  ".gitignore",
  ".orange-tpot-version",
  "package.json",
  "README.md",
  "SYNC_FULL.md",
  "scripts/sync-posts.ts",
  "qmd/README.md",
];

/** Template-owned paths for index repo (relative to templates/index). User-owned: creators/repos.json, creators/manifest.json, subrepos/ */
const INDEX_TEMPLATE_FILES = [
  ".github/workflows/update-subrepos.yml",
  ".github/workflows/update-from-template.yml",
  ".orange-tpot-version",
  "package.json",
  "README.md",
  "scripts/update-manifest.ts",
  "scripts/sync-all-subrepos.ts",
];

export type RepoType = "creator" | "index";

export async function detectRepoType(dir: string): Promise<RepoType | null> {
  try {
    await readFile(join(dir, "creator.json"), "utf-8");
    return "creator";
  } catch {
    // not creator
  }
  try {
    await readFile(join(dir, "creators", "repos.json"), "utf-8");
    return "index";
  } catch {
    // not index
  }
  return null;
}

export async function getCurrentVersion(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, ".orange-tpot-version"), "utf-8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/** Fetch latest release tag from GitHub API. If no releases (404), return default branch (main). */
export async function fetchLatestVersion(): Promise<string> {
  const repo = getTemplateRepo();
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": "orange-tpot-update" },
  });
  if (res.status === 404) {
    return TEMPLATE_DEFAULT_REF;
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch latest release: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { tag_name?: string };
  const tag = data.tag_name;
  if (!tag || typeof tag !== "string") throw new Error("No tag_name in release");
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/** Download tarball to a temp file and extract with system tar. Returns path to extracted top-level dir. */
async function fetchAndExtractTarball(version: string): Promise<{ tmpDir: string; topDir: string }> {
  const url = getTemplateTarballUrl(version);
  const res = await fetch(url, { headers: { "User-Agent": "orange-tpot-update" } });
  if (!res.ok) throw new Error(`Failed to fetch tarball ${url}: ${res.status}`);

  const tmpDir = join(tmpdir(), `orange-tpot-update-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const tarballPath = join(tmpDir, "archive.tar.gz");
  const buffer = await res.arrayBuffer();
  await writeFile(tarballPath, Buffer.from(buffer));

  const result = spawnSync("tar", ["-xzf", tarballPath, "-C", tmpDir], { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`tar extract failed: ${result.stderr?.toString() || "unknown"}`);
  }

  const entries = await readdir(tmpDir, { withFileTypes: true });
  const topDirEntry = entries.find((e) => e.isDirectory() && !e.name.startsWith("."));
  if (!topDirEntry) throw new Error("No top-level directory in tarball");
  return { tmpDir, topDir: topDirEntry.name };
}

/** Copy a file or directory from src to dest. For files, overwrite. */
async function copyRecursive(src: string, dest: string): Promise<void> {
  const st = await stat(src);
  if (st.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const e of entries) {
      await copyRecursive(join(src, e.name), join(dest, e.name));
    }
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  const content = await readFile(src);
  await writeFile(dest, content);
}

/** Run update: fetch version (or use specified), extract tarball, copy template-owned files to targetDir. */
export async function runUpdate(
  targetDir: string,
  versionOverride?: string
): Promise<{ version: string; type: RepoType; filesUpdated: number }> {
  const type = await detectRepoType(targetDir);
  if (!type) throw new Error("Not an orange-tpot repo (no creator.json or creators/repos.json)");

  const versionToFetch =
    versionOverride?.trim() && versionOverride !== "latest"
      ? versionOverride.replace(/^v/, "")
      : await fetchLatestVersion();

  const { tmpDir, topDir } = await fetchAndExtractTarball(versionToFetch);
  const templateBase = join(tmpDir, topDir, "templates", type);

  const fileList = type === "creator" ? CREATOR_TEMPLATE_FILES : INDEX_TEMPLATE_FILES;
  let filesUpdated = 0;
  for (const rel of fileList) {
    const src = join(templateBase, rel);
    try {
      await stat(src);
    } catch {
      continue; // file might not exist in this version (e.g. new workflow)
    }
    const dest = join(targetDir, rel);
    await copyRecursive(src, dest);
    filesUpdated++;
  }

  await writeFile(join(targetDir, ".orange-tpot-version"), `${versionToFetch}\n`, "utf-8");
  filesUpdated++;

  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  return { version: versionToFetch, type, filesUpdated };
}
