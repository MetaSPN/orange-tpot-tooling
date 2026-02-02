/**
 * Run sync (blog-toolkit pull + ingest) in each creator repo under subrepos/.
 * Retries failed repos; uses current state (ingest dedupes by URL so no duplicate downloads).
 * Run from index repo root: bun run sync-all
 * With options (use -- before args): bun run sync-all -- --delay 5 --retries 2
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SUBREPOS_DIR = join(ROOT, "subrepos");

function parseArgs(argv: string[]): { delaySec: number; retries: number } {
  let delaySec = 3;
  let retries = 2;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--delay" || argv[i] === "-d") && argv[i + 1]) {
      delaySec = Math.max(0, parseInt(argv[++i], 10) || 0);
    } else if ((argv[i] === "--retries" || argv[i] === "-r") && argv[i + 1]) {
      retries = Math.max(1, parseInt(argv[++i], 10) || 1);
    }
  }
  return { delaySec, retries };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSync(cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", "sync"], { cwd, stdio: "pipe", encoding: "utf-8" });
  return {
    status: result.status ?? -1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { delaySec, retries } = parseArgs(argv);

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

  console.log(`Syncing ${toSync.length} creator repo(s) (delay ${delaySec}s, up to ${retries} attempt(s) each)...`);
  const failed: { slug: string; lastStderr: string; lastStdout: string }[] = [];
  let ok = 0;

  function attempt(slug: string, attemptNum: number): boolean {
    const cwd = join(SUBREPOS_DIR, slug);
    const { status, stdout, stderr } = runSync(cwd);
    if (status === 0) {
      const line = (stdout || "").split("\n").pop() || "ok";
      console.log(`  ${slug}: ${line}`);
      return true;
    }
    const errSnippet = (stderr || stdout || "").slice(0, 300);
    console.error(`  ${slug}: failed${attemptNum > 1 ? ` (retry ${attemptNum})` : ""}`);
    if (errSnippet) console.error(errSnippet + (errSnippet.length >= 300 ? "…" : ""));
    failed.push({ slug, lastStderr: stderr, lastStdout: stdout });
    return false;
  }

  for (let round = 1; round <= retries; round++) {
    if (round > 1) {
      if (failed.length === 0) break;
      console.log(`\nRetrying ${failed.length} failed repo(s) (attempt ${round}/${retries})...`);
      const toRetry = failed.splice(0, failed.length);
      for (const { slug } of toRetry) {
        if (attempt(slug, round)) ok++;
        if (delaySec > 0) await sleep(delaySec * 1000);
      }
      continue;
    }
    for (const slug of toSync) {
      if (attempt(slug, 1)) ok++;
      if (delaySec > 0) await sleep(delaySec * 1000);
    }
  }

  const failCount = failed.length;
  console.log(`\nDone: ${ok} ok, ${failCount} failed`);

  if (failCount > 0) {
    console.log("\nFailed repos:");
    for (const { slug } of failed) {
      console.log(`  - ${slug}`);
    }
    const failuresPath = join(ROOT, "sync-failures.txt");
    const lines = failed.map((f) => f.slug);
    await writeFile(failuresPath, lines.join("\n") + "\n", "utf-8");
    console.log(`\nWrote ${failCount} slug(s) to ${failuresPath}`);
  }
}

main();
