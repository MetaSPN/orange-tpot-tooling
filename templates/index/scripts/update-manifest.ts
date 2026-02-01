/**
 * Regenerate creators/manifest.json from subrepos (or from repos.json URLs).
 * Run from index repo root. If subrepos/<slug> exist, read creator.json and metadata count.
 * Optionally: if creators/repos.json has repo URLs and no subrepos, fetch creator.json via raw GitHub URL.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SUBREPOS_DIR = join(ROOT, "subrepos");
const CREATORS_DIR = join(ROOT, "creators");

interface CreatorJson {
  displayName: string;
  blogName?: string | null;
  blogUrl?: string | null;
  followUrl?: string | null;
  feedUrls?: string[];
  slug: string;
  hexId?: string;
}

interface ManifestEntry {
  slug: string;
  displayName: string;
  blogUrl: string | null;
  followUrl: string | null;
  repo: string | null;
  lastUpdated: string | null;
  postCount: number;
}

async function fromSubrepos(): Promise<ManifestEntry[]> {
  const entries = await readdir(SUBREPOS_DIR, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory());
  const manifest: ManifestEntry[] = [];

  for (const d of dirs) {
    const creatorPath = join(SUBREPOS_DIR, d.name, "creator.json");
    let creator: CreatorJson;
    try {
      const raw = await readFile(creatorPath, "utf-8");
      creator = JSON.parse(raw);
    } catch {
      continue;
    }
    const metaDir = join(SUBREPOS_DIR, d.name, "metadata");
    const metaFiles = await readdir(metaDir).catch(() => []);
    const postCount = metaFiles.filter((f) => f.endsWith(".json")).length;

    manifest.push({
      slug: creator.slug ?? d.name,
      displayName: creator.displayName ?? d.name,
      blogUrl: creator.blogUrl ?? null,
      followUrl: creator.followUrl ?? null,
      repo: null,
      lastUpdated: null,
      postCount,
    });
  }

  return manifest.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function main() {
  const manifest = await fromSubrepos();
  const manifestPath = join(CREATORS_DIR, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`Wrote ${manifest.length} creator(s) to creators/manifest.json`);
}

main();
