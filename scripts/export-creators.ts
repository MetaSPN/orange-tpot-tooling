/**
 * Export the blogger dump to data/creators.json (master list format).
 * Run from repo root: bun run scripts/export-creators.ts [--data-dir <path>]
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { parseBloggerDirectory } from "../src/parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_DATA_DIR = join(ROOT, "Private & Shared", "Orange TPOT Directory");

async function main() {
  const dataDir = process.argv.includes("--data-dir")
    ? process.argv[process.argv.indexOf("--data-dir") + 1]
    : DEFAULT_DATA_DIR;

  const bloggers = await parseBloggerDirectory(dataDir);
  const withFeed = bloggers.filter((b) => b.hasFeed);

  const list = withFeed.map((b) => ({
    displayName: b.displayName,
    blogUrl: b.blogUrl ?? "",
    ...(b.blogName ? { blogName: b.blogName } : {}),
    ...(b.followUrl ? { followUrl: b.followUrl } : {}),
    ...(b.imageUrl ? { imageUrl: b.imageUrl } : {}),
  }));

  const outPath = join(ROOT, "data", "creators.json");
  await writeFile(outPath, JSON.stringify(list, null, 2), "utf-8");
  console.log(`Wrote ${list.length} creators to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
