#!/usr/bin/env bun
/**
 * CLI: create-creator (--user <id> | --all), create-index, add-to-index.
 * No args or create-creator without --user/--all → interactive flow.
 */

import { createInterface } from "node:readline";
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
  console.log("  4) Exit");
  const choice = await question(rl, "Choice (1-4)", "1");
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
  }
  // choice 4: Exit — do nothing
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (command === "create-creator") {
    await createCreator(args);
  } else if (command === "create-index") {
    await createIndex(args);
  } else if (command === "add-to-index") {
    await addToIndex(args);
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
  add-to-index --repo <url>             Add a creator repo to the index (optionally as submodule)

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

Options (add-to-index):
  --repo <url>         Creator repo URL (required)
  --slug <name>        Slug for submodule dir (default: from repo path)
  --index-dir <path>   Index repo path (default: ./index-repo)
  --submodule          Add as git submodule under subrepos/<slug>
  --dry-run            Print what would be done

Examples:
  bun run src/cli.ts create-creator --user "Holly Elmore"
  bun run src/cli.ts create-creator --all --output-dir ./my-creators --dry-run
  bun run src/cli.ts create-index
  bun run src/cli.ts add-to-index --repo https://github.com/you/holly-elmore-archive --slug holly-elmore --index-dir ./index-repo --submodule
`);
  } else {
    console.error("Unknown command:", command);
    process.exit(1);
  }
}

main();
