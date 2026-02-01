/**
 * Scaffold the index repo: copy templates/index to outputDir.
 * addCreatorToIndex: append repo to creators/repos.json and optionally add as git submodule.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates", "index");

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = join(src, e.name);
    const destPath = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      const content = await readFile(srcPath, "utf-8");
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content, "utf-8");
    }
  }
}

/**
 * Scaffold the index repo at outputDir (e.g. ./index-repo).
 */
export async function scaffoldIndexRepo(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await copyDirRecursive(TEMPLATES_DIR, outputDir);
}

type ReposEntry = string | { url: string; slug?: string };

/**
 * Add a creator repo to the index: append to creators/repos.json; optionally run git submodule add.
 */
export async function addCreatorToIndex(
  indexDir: string,
  repoUrl: string,
  slug: string,
  asSubmodule: boolean
): Promise<void> {
  const reposPath = join(indexDir, "creators", "repos.json");
  let repos: ReposEntry[] = [];
  try {
    const raw = await readFile(reposPath, "utf-8");
    repos = JSON.parse(raw);
    if (!Array.isArray(repos)) repos = [];
  } catch {
    repos = [];
  }
  const existing = repos.some(
    (r) => (typeof r === "string" ? r : r.url) === repoUrl
  );
  if (!existing) {
    repos.push({ url: repoUrl, slug });
    await writeFile(reposPath, JSON.stringify(repos, null, 2), "utf-8");
  }
  if (asSubmodule) {
    const subreposDir = join(indexDir, "subrepos");
    await mkdir(subreposDir, { recursive: true });
    const submodulePath = join("subrepos", slug);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["submodule", "add", repoUrl, submodulePath], {
        cwd: indexDir,
        stdio: "inherit",
      });
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git submodule add exited ${code}`))));
      child.on("error", reject);
    }).catch((err) => {
      console.warn("git submodule add failed (run manually if needed):", err.message);
    });
  }
}
