/**
 * Run sync (blog-toolkit pull + ingest) in each creator repo under subrepos/.
 * Run from index repo root: bun run sync-all
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SUBREPOS_DIR = join(ROOT, "subrepos");

async function main(): Promise<void> {
  const entries = await readdir(SUBREPOS_DIR, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));

  if (dirs.length === 0) {
    console.log("No subrepos found under subrepos/");
    return;
  }

  const toSync: string[] = [];
  for (const d of dirs) {
    const creatorPath = join(SUBREPOS_DIR, d.name, "creator.json");
    const syncScript = join(SUBREPOS_DIR, d.name, "scripts", "sync-posts.ts");
    try {
      await readFile(creatorPath, "utf-8");
      await readFile(syncScript, "utf-8");
      toSync.push(d.name);
    } catch {
      // skip if not a creator repo
    }
  }

  if (toSync.length === 0) {
    console.log("No creator repos (creator.json + scripts/sync-posts.ts) found under subrepos/");
    return;
  }

  console.log(`Syncing ${toSync.length} creator repo(s)...`);
  let ok = 0;
  let fail = 0;

  for (const slug of toSync) {
    const cwd = join(SUBREPOS_DIR, slug);
    const result = spawnSync("bun", ["run", "sync"], { cwd, stdio: "pipe", encoding: "utf-8" });
    if (result.status === 0) {
      ok++;
      const out = (result.stdout || "").trim();
      if (out) console.log(`  ${slug}: ${out.split("\n").pop() || "ok"}`);
      else console.log(`  ${slug}: ok`);
    } else {
      fail++;
      const err = (result.stderr || result.stdout || "").trim();
      console.error(`  ${slug}: failed`);
      if (err) console.error(err.slice(0, 200) + (err.length > 200 ? "…" : ""));
    }
  }

  console.log(`Done: ${ok} ok, ${fail} failed`);
}

main();
