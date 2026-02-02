#!/usr/bin/env bun
/**
 * CLI: create-creator (--user <id> | --all), create-index, add-to-index.
 * No args or create-creator without --user/--all → interactive flow.
 */

import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseBloggerDirectory, findBlogger, bloggerFromManual, type Blogger } from "./parser";
import { scaffoldCreatorRepo } from "./scaffold-creator";
import { getFeedUrl } from "./feeds";
import { getMasterListUrl } from "./config";

const DEFAULT_DATA_DIR = join(process.cwd(), "Private & Shared", "Orange TPOT Directory");
const DEFAULT_OUTPUT_DIR = join(process.cwd(), "creators");

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out["dry-run"] = true;
    else if (arg === "--all") out["all"] = true;
    else if ((arg === "--user" || arg === "-u") && argv[i + 1]) {
      out["user"] = argv[++i];
    } else if (arg === "--data-dir" && argv[i + 1]) {
      out["data-dir"] = argv[++i];
    } else if (arg === "--output-dir" && argv[i + 1]) {
      out["output-dir"] = argv[++i];
    } else if (arg === "--repo" && argv[i + 1]) {
      out["repo"] = argv[++i];
    } else if (arg === "--slug" && argv[i + 1]) {
      out["slug"] = argv[++i];
    } else if (arg === "--index-dir" && argv[i + 1]) {
      out["index-dir"] = argv[++i];
    } else if (arg === "--submodule") {
      out["submodule"] = true;
    } else if (arg === "--discover-feed") {
      out["discover-feed"] = true;
    } else if (arg === "--list-url" && argv[i + 1]) {
      out["list-url"] = argv[++i];
    } else if (arg === "--limit" && argv[i + 1]) {
      out["limit"] = argv[++i];
    } else if (arg === "--repo-base-url" && argv[i + 1]) {
      out["repo-base-url"] = argv[++i];
    } else if (arg === "--dir" && argv[i + 1]) {
      out["dir"] = argv[++i];
    } else if (arg === "--version" && argv[i + 1]) {
      out["version"] = argv[++i];
    }
  }
  return out;
}

function question(rl: ReturnType<typeof createInterface>, prompt: string, defaultValue = ""): Promise<string> {
  const p = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
  return new Promise((resolve) => rl.question(p, (ans) => resolve((ans || defaultValue).trim())));
}

interface MasterListEntry {
  displayName: string;
  blogUrl: string;
  blogName?: string;
  followUrl?: string;
  imageUrl?: string;
}

async function fetchMasterList(url: string): Promise<MasterListEntry[]> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Master list URL returned ${res.status} (expected 200). Check that the repo and data/creators.json exist. URL: ${url}`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      `Master list URL did not return valid JSON (got ${text.slice(0, 80)}...). Check the URL.`
    );
  }
  if (Array.isArray(raw)) return raw as MasterListEntry[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { creators?: unknown }).creators)) {
    return (raw as { creators: MasterListEntry[] }).creators;
  }
  return [];
}

function masterEntryToBlogger(e: MasterListEntry): Blogger {
  return bloggerFromManual(e.displayName, e.blogUrl, e.followUrl ?? undefined, e.blogName ?? undefined);
}

async function runInteractiveCreatorFlow(args: Record<string, string | boolean>): Promise<void> {
  const outputDir = (args["output-dir"] as string) || DEFAULT_OUTPUT_DIR;
  const listUrlOverride = args["list-url"] as string | undefined;
  const discoverFeed = !!args["discover-feed"];
  const dryRun = !!args["dry-run"];
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nWhere do you want to get the creator from?");
  console.log("  1) Pick from master list");
  console.log("  2) Enter manually");
  console.log("  3) Use local directory");
  const choice = await question(rl, "Choice (1/2/3)", "2");

  let toCreate: Blogger[] = [];

  if (choice === "1") {
    const url = getMasterListUrl(listUrlOverride);
    if (!url) {
      console.log("No master list URL configured. Use --list-url <url> or set ORANGE_TPOT_MASTER_LIST_URL, or choose 'Enter manually'.");
      rl.close();
      return;
    }
    let list: MasterListEntry[];
    try {
      list = await fetchMasterList(url);
    } catch (err) {
      console.error("Failed to fetch master list:", err);
      rl.close();
      return;
    }
    const withFeed = list.filter((e) => e.blogUrl?.trim());
    if (withFeed.length === 0) {
      console.log("No creators with Blog URL in the list.");
      rl.close();
      return;
    }
    console.log("\nCreators (with blog URL):");
    withFeed.forEach((e, i) => {
      console.log(`  ${i + 1}) ${e.displayName} — ${e.blogUrl}`);
    });
    const pick = await question(rl, `Enter number(s) to create (e.g. 1 or 1,3,5)`, "1");
    const indices = pick.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 1 && n <= withFeed.length);
    toCreate = indices.map((n) => masterEntryToBlogger(withFeed[n - 1]!));
  } else if (choice === "2") {
    const displayName = await question(rl, "Display name", "");
    const blogUrl = await question(rl, "Blog URL", "");
    if (!displayName || !blogUrl) {
      console.log("Display name and Blog URL are required.");
      rl.close();
      return;
    }
    const followUrl = await question(rl, "Follow URL (optional)", "");
    const blogName = await question(rl, "Blog name (optional)", "");
    toCreate = [bloggerFromManual(displayName, blogUrl, followUrl || undefined, blogName || undefined)];
  } else {
    const dataDir = (args["data-dir"] as string) || DEFAULT_DATA_DIR;
    let bloggers: Blogger[];
    try {
      bloggers = await parseBloggerDirectory(dataDir);
    } catch (err) {
      console.error("Failed to read blogger directory:", (err as Error).message);
      rl.close();
      return;
    }
    const withFeed = bloggers.filter((b) => b.hasFeed);
    if (withFeed.length === 0) {
      console.log("No bloggers with Blog URL found in", dataDir);
      rl.close();
      return;
    }
    console.log("\nEnter creator name or hex id, or 'all' to create all:");
    const user = await question(rl, "Creator");
    if (user.toLowerCase() === "all") {
      toCreate = withFeed;
    } else {
      const found = findBlogger(bloggers, user);
      if (!found) {
        console.log("Blogger not found:", user);
        rl.close();
        return;
      }
      if (!found.hasFeed) {
        console.log("Blogger has no Blog URL:", found.displayName);
        rl.close();
        return;
      }
      toCreate = [found];
    }
  }

  rl.close();

  for (const blogger of toCreate) {
    const repoPath = join(outputDir, blogger.slug);
    if (dryRun) {
      console.log(`[dry-run] Would create ${repoPath} for ${blogger.displayName}`);
      continue;
    }
    await scaffoldCreatorRepo(blogger, repoPath, { discoverFeed });
    console.log(`Created ${repoPath}`);
  }
}

async function runInteractiveMainMenu(args: Record<string, string | boolean>): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\norange-tpot — Creator repos + index tooling\n");
  console.log("  1) Create a creator repo");
  console.log("  2) Create an index repo");
  console.log("  3) Add a creator repo to an index");
  console.log("  4) Bootstrap index (create index + all creators from master list)");
  console.log("  5) Exit");
  const choice = await question(rl, "Choice (1-5)", "1");
  rl.close();

  if (choice === "1") {
    await runInteractiveCreatorFlow(args);
  } else if (choice === "2") {
    const outputDir = await new Promise<string>((resolve) => {
      const r = createInterface({ input: process.stdin, output: process.stdout });
      r.question("Output directory [./index-repo]: ", (ans) => {
        r.close();
        resolve((ans || "./index-repo").trim());
      });
    });
    const { scaffoldIndexRepo } = await import("./scaffold-index");
    const dir = outputDir.startsWith("/") ? outputDir : join(process.cwd(), outputDir);
    await scaffoldIndexRepo(dir);
    console.log(`Created index repo at ${dir}`);
  } else if (choice === "3") {
    const r2 = createInterface({ input: process.stdin, output: process.stdout });
    const repo = await question(r2, "Creator repo URL");
    const slug = await question(r2, "Slug (default from URL)");
    const indexDir = await question(r2, "Index repo path", "./index-repo");
    const sub = await question(r2, "Add as submodule? (y/n)", "n");
    r2.close();
    if (!repo) {
      console.log("Repo URL is required.");
      return;
    }
    const indexPath = indexDir.startsWith("/") ? indexDir : join(process.cwd(), indexDir);
    const { addCreatorToIndex } = await import("./scaffold-index");
    const resolvedSlug = slug || repo.replace(/\/$/, "").split("/").pop()?.replace(/\.git$/, "") || "creator";
    await addCreatorToIndex(indexPath, repo, resolvedSlug, sub.toLowerCase() === "y" || sub.toLowerCase() === "yes");
    console.log(`Added ${repo} to index (slug: ${resolvedSlug})`);
  } else if (choice === "4") {
    const r3 = createInterface({ input: process.stdin, output: process.stdout });
    const indexDir = await question(r3, "Index directory [./index-repo]", "./index-repo");
    const limitStr = await question(r3, "Limit number of creators (blank = all)", "");
    const repoBaseUrl = await question(r3, "Repo base URL (e.g. https://github.com/myorg, blank = REPLACE_ME)", "");
    r3.close();
    const bootstrapArgs: Record<string, string | boolean> = {
      "index-dir": indexDir.startsWith("/") ? indexDir : join(process.cwd(), indexDir),
      "list-url": args["list-url"] as string | undefined,
      "dry-run": false,
    };
    if (limitStr.trim()) bootstrapArgs["limit"] = limitStr.trim();
    if (repoBaseUrl.trim()) bootstrapArgs["repo-base-url"] = repoBaseUrl.trim();
    await bootstrapIndex(bootstrapArgs);
  }
  // choice 5: Exit — do nothing
}

async function createCreator(args: Record<string, string | boolean>): Promise<void> {
  const dataDir = (args["data-dir"] as string) || DEFAULT_DATA_DIR;
  const outputDir = (args["output-dir"] as string) || DEFAULT_OUTPUT_DIR;
  const dryRun = !!args["dry-run"];
  const all = !!args["all"];
  const user = args["user"] as string | undefined;
  const discoverFeed = !!args["discover-feed"];

  if (!all && !user) {
    await runInteractiveCreatorFlow(args);
    return;
  }

  const bloggers = await parseBloggerDirectory(dataDir).catch((err) => {
    console.error("Failed to read blogger directory:", err.message);
    process.exit(1);
  });

  const withFeed = bloggers.filter((b) => b.hasFeed);
  if (withFeed.length === 0) {
    console.error("No bloggers with Blog URL found in", dataDir);
    process.exit(1);
  }

  let toCreate: Blogger[];
  if (all) {
    toCreate = withFeed;
    console.log(`Creating ${toCreate.length} creator repo(s) for bloggers with feed...`);
  } else {
    const found = findBlogger(bloggers, user!);
    if (!found) {
      console.error("Blogger not found:", user);
      process.exit(1);
    }
    if (!found.hasFeed) {
      console.error("Blogger has no Blog URL (cannot sync feed):", found.displayName);
      process.exit(1);
    }
    toCreate = [found];
  }

  for (const blogger of toCreate) {
    const repoPath = join(outputDir, blogger.slug);
    const feedUrl = blogger.blogUrl ? getFeedUrl(blogger.blogUrl) : "";
    if (dryRun) {
      console.log(`[dry-run] Would create ${repoPath} for ${blogger.displayName} (feed: ${feedUrl})`);
      continue;
    }
    await scaffoldCreatorRepo(blogger, repoPath, { discoverFeed });
    console.log(`Created ${repoPath}`);
  }
}

async function createIndex(args: Record<string, string | boolean>): Promise<void> {
  const outputDir = (args["output-dir"] as string) || join(process.cwd(), "index-repo");
  const dryRun = !!args["dry-run"];
  const { scaffoldIndexRepo } = await import("./scaffold-index");
  if (dryRun) {
    console.log(`[dry-run] Would create index repo at ${outputDir}`);
    return;
  }
  await scaffoldIndexRepo(outputDir);
  console.log(`Created index repo at ${outputDir}`);
}

async function bootstrapIndex(args: Record<string, string | boolean>): Promise<void> {
  const indexDir = (args["index-dir"] as string) || join(process.cwd(), "index-repo");
  const listUrlOverride = args["list-url"] as string | undefined;
  const limitRaw = args["limit"] as string | undefined;
  const limit = limitRaw ? Math.max(0, parseInt(limitRaw, 10)) : undefined;
  const repoBaseUrl = (args["repo-base-url"] as string)?.trim();
  const dryRun = !!args["dry-run"];

  const listUrl = getMasterListUrl(listUrlOverride);
  let list: MasterListEntry[];
  try {
    list = await fetchMasterList(listUrl);
  } catch (err) {
    console.error("Failed to fetch master list:", err);
    process.exit(1);
  }

  const withFeed = list.filter((e) => e.blogUrl?.trim());
  const toCreate = limit != null ? withFeed.slice(0, limit) : withFeed;
  if (toCreate.length === 0) {
    console.log("No creators with Blog URL in the list.");
    return;
  }

  console.log(`Bootstrap: creating index (if needed) and ${toCreate.length} creator repo(s) in ${indexDir}...`);

  if (!dryRun) {
    const { scaffoldIndexRepo, addCreatorToIndex } = await import("./scaffold-index");
    const { existsSync } = await import("node:fs");
    const reposPath = join(indexDir, "creators", "repos.json");
    if (!existsSync(reposPath)) {
      await mkdir(indexDir, { recursive: true });
      await scaffoldIndexRepo(indexDir);
    }
    const subreposDir = join(indexDir, "subrepos");
    await mkdir(subreposDir, { recursive: true });

    for (const e of toCreate) {
      const blogger = masterEntryToBlogger(e);
      const repoPath = join(subreposDir, blogger.slug);
      await scaffoldCreatorRepo(blogger, repoPath);
      const url = repoBaseUrl
        ? `${repoBaseUrl.replace(/\/$/, "")}/${blogger.slug}`
        : `https://github.com/REPLACE_ME/${blogger.slug}`;
      await addCreatorToIndex(indexDir, url, blogger.slug, false);
      console.log(`  ${blogger.slug}`);
    }

    const { spawnSync } = await import("node:child_process");
    const res = spawnSync("bun", ["run", "update-manifest"], { cwd: indexDir, stdio: "inherit" });
    if (res.status !== 0) {
      console.warn("update-manifest failed (run manually from index repo): bun run update-manifest");
    } else {
      console.log("Updated creators/manifest.json");
    }
  } else {
    toCreate.slice(0, 5).forEach((e, i) => {
      const b = masterEntryToBlogger(e);
      console.log(`  [dry-run] ${i + 1}) ${e.displayName} → subrepos/${b.slug}`);
    });
    if (toCreate.length > 5) console.log(`  ... and ${toCreate.length - 5} more`);
  }

  console.log(`Done. Others can filter the index (edit creators/repos.json or remove subrepos) to keep only the creators they want.`);
}

async function addToIndex(args: Record<string, string | boolean>): Promise<void> {
  const indexDir = (args["index-dir"] as string) || join(process.cwd(), "index-repo");
  const repo = args["repo"] as string | undefined;
  const slug = args["slug"] as string | undefined;
  const dryRun = !!args["dry-run"];
  const asSubmodule = !!args["submodule"];

  if (!repo) {
    console.error("Usage: add-to-index --repo <url> [--slug <slug>] [--index-dir <path>] [--submodule] [--dry-run]");
    process.exit(1);
  }

  const { addCreatorToIndex } = await import("./scaffold-index");
  const resolvedSlug = slug || repo.replace(/\/$/, "").split("/").pop()?.replace(/\.git$/, "") || "creator";
  if (dryRun) {
    console.log(`[dry-run] Would add ${repo} to ${indexDir}/creators/repos.json (slug: ${resolvedSlug})${asSubmodule ? " and as submodule" : ""}`);
    return;
  }
  await addCreatorToIndex(indexDir, repo, resolvedSlug, asSubmodule);
  console.log(`Added ${repo} to index (slug: ${resolvedSlug})`);
}

async function runUpdateCommand(args: Record<string, string | boolean>): Promise<void> {
  const dir = (args["dir"] as string) || process.cwd();
  const targetDir = dir.startsWith("/") ? dir : join(process.cwd(), dir);
  const versionOverride = args["version"] as string | undefined;

  const { runUpdate, getCurrentVersion, detectRepoType } = await import("./update-from-template");
  const type = await detectRepoType(targetDir);
  if (!type) {
    console.error("Not an orange-tpot repo. Run this from a creator or index repo root, or use --dir <path>.");
    process.exit(1);
  }
  const current = await getCurrentVersion(targetDir);
  console.log(`Current version: ${current ?? "unknown"}`);
  console.log(`Updating ${type} repo...`);
  try {
    const { version, filesUpdated } = await runUpdate(targetDir, versionOverride);
    console.log(`Updated to v${version} (${filesUpdated} file(s))`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (command === "create-creator") {
    await createCreator(args);
  } else if (command === "create-index") {
    await createIndex(args);
  } else if (command === "bootstrap-index") {
    await bootstrapIndex(args);
  } else if (command === "add-to-index") {
    await addToIndex(args);
  } else if (command === "update") {
    await runUpdateCommand(args);
  } else if (!command || command === "--help" || command === "-h") {
    if (!command || argv.length === 0) {
      await runInteractiveMainMenu(args);
      return;
    }
    console.log(`
orange-tpot — Creator repos + index tooling

Commands:
  create-creator --user <id-or-name>   Create repo for one blogger (by hex id or display name)
  create-creator --all                 Create repos for all bloggers that have a Blog URL
  create-index                         Create index repo (manifest + update workflow)
  bootstrap-index                      Create index + all creator repos from master list (filter down later)
  add-to-index --repo <url>            Add a creator repo to the index (optionally as submodule)
  update                               Update this repo from the orange-tpot template (creator or index)

Run with no arguments for the interactive menu (master list, manual entry, or local directory).

Options (create-creator):
  --data-dir <path>    Blogger directory (default: ./Private & Shared/Orange TPOT Directory)
  --output-dir <path>  Where to create repo(s) (default: ./creators)
  --list-url <url>     Master list URL (for interactive "Pick from list"; or set ORANGE_TPOT_MASTER_LIST_URL)
  --discover-feed      For custom domains, discover feed URL via HTML link tags and validate
  --dry-run            Print what would be created

Options (create-index):
  --output-dir <path>  Where to create index repo (default: ./index-repo)
  --dry-run            Print what would be created

Options (bootstrap-index):
  --index-dir <path>     Where to create/use index repo (default: ./index-repo)
  --list-url <url>       Master list URL (default: ORANGE_TPOT_MASTER_LIST_URL or orange-tpot data/creators.json)
  --limit <n>             Cap number of creators (default: all)
  --repo-base-url <url>  Base URL for repos in index (e.g. https://github.com/myorg); else REPLACE_ME
  --dry-run              Print what would be created

Options (add-to-index):
  --repo <url>         Creator repo URL (required)
  --slug <name>        Slug for submodule dir (default: from repo path)
  --index-dir <path>   Index repo path (default: ./index-repo)
  --submodule          Add as git submodule under subrepos/<slug>
  --dry-run            Print what would be done

Options (update):
  --dir <path>         Repo to update (default: current directory)
  --version <ver>      Template version to apply (default: latest release)

Examples:
  bun run src/cli.ts create-creator --user "Holly Elmore"
  bun run src/cli.ts create-creator --all --output-dir ./my-creators --dry-run
  bun run src/cli.ts create-index
  bun run src/cli.ts add-to-index --repo https://github.com/you/holly-elmore-archive --slug holly-elmore --index-dir ./index-repo --submodule
  bun run src/cli.ts bootstrap-index --index-dir ./index-repo --limit 50
  bun run src/cli.ts bootstrap-index --index-dir ./index-repo --repo-base-url https://github.com/myorg
  bun run src/cli.ts update
  bun run src/cli.ts update --version 0.1.2
`);
  } else {
    console.error("Unknown command:", command);
    process.exit(1);
  }
}

main();
