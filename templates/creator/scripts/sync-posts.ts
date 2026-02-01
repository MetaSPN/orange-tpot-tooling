/**
 * Sync script for creator repo: runs blog-toolkit pull then ingests JSON into posts/ and metadata/.
 * Requires uv/uvx and blog-toolkit (uvx blog-toolkit pull). Run from creator repo root: bun run scripts/sync-posts.ts
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BLOG_TOOLKIT_OUTPUT = "blog-toolkit-posts.json";

interface CreatorJson {
  displayName: string;
  blogName?: string | null;
  blogUrl?: string | null;
  followUrl?: string | null;
  feedUrls: string[];
  slug: string;
}

/** Blog-toolkit pull output: array of posts or { posts: [...] }. Each post may use link/url, published/pub_date/published_at/date, content/body/description, title, guid/id. */
type BlogToolkitRaw = unknown;

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "post";
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Normalize post URL for dedup: absolute, no hash, optional trailing slash normalized. */
function normalizePostUrl(url: string, base?: string): string {
  try {
    const u = new URL(url.trim(), base || "https://example.com");
    u.hash = "";
    u.search = u.search || "";
    let path = u.pathname.replace(/\/$/, "") || "/";
    u.pathname = path;
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** Parse date from blog-toolkit field (published, pub_date, published_at, date). */
function parsePostDate(raw: BlogToolkitRaw): Date | null {
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw : String(raw);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Get link from blog-toolkit post: link or url. */
function getPostLink(post: Record<string, unknown>, blogUrl: string): string | null {
  const link = (post.link ?? post.url) as string | undefined;
  if (typeof link === "string" && link.trim()) return normalizePostUrl(link, blogUrl);
  return null;
}

/** Get content from blog-toolkit post: content, body, or description. */
function getPostContent(post: Record<string, unknown>): string {
  const raw = (post.content ?? post.body ?? post.description) as string | undefined;
  return (typeof raw === "string" ? raw : "").trim() || "See link for full content.";
}

/** Get title from blog-toolkit post. */
function getPostTitle(post: Record<string, unknown>): string {
  const t = post.title as string | undefined;
  return (typeof t === "string" ? t : "").trim() || "Untitled";
}

/** Get guid from blog-toolkit post: guid or id or link. */
function getPostGuid(post: Record<string, unknown>, link: string): string {
  const g = (post.guid ?? post.id ?? post.link ?? post.url) as string | undefined;
  return (typeof g === "string" ? g : "").trim() || link;
}

/**
 * Ingest blog-toolkit pull JSON into posts/ and metadata/.
 * Handles top-level array or { posts: [...] }. Maps link/url, published/pub_date/published_at/date, content/body/description, title, guid/id.
 * Returns number of posts written.
 */
async function ingestBlogToolkitJson(
  jsonPath: string,
  rootDir: string,
  creator: CreatorJson
): Promise<number> {
  const raw = await readFile(jsonPath, "utf-8");
  const data = JSON.parse(raw) as BlogToolkitRaw;

  let items: Record<string, unknown>[];
  if (Array.isArray(data)) {
    items = data as Record<string, unknown>[];
  } else if (data && typeof data === "object" && "posts" in data && Array.isArray((data as { posts: unknown }).posts)) {
    items = (data as { posts: Record<string, unknown>[] }).posts;
  } else {
    throw new Error("blog-toolkit JSON must be an array of posts or { posts: [...] }");
  }

  const blogUrl = (creator.blogUrl || "").trim();
  const feedUrl = (Array.isArray(creator.feedUrls) && creator.feedUrls[0]) || blogUrl || "";
  const source = blogUrl.includes("substack.com") ? "substack" : "blog";

  const postsDir = join(rootDir, "posts");
  const metadataDir = join(rootDir, "metadata");
  await mkdir(postsDir, { recursive: true });
  await mkdir(metadataDir, { recursive: true });

  const seenUrls = new Set<string>();
  const seenFilenames = new Set<string>();

  const existingMeta = await readdir(metadataDir).catch(() => []);
  for (const f of existingMeta) {
    if (!f.endsWith(".json")) continue;
    try {
      const metaRaw = await readFile(join(metadataDir, f), "utf-8");
      const meta = JSON.parse(metaRaw) as { link?: string };
      if (meta.link) seenUrls.add(normalizePostUrl(meta.link));
    } catch {
      // ignore
    }
  }
  const existingPosts = await readdir(postsDir).catch(() => []);
  for (const f of existingPosts) {
    if (f.endsWith(".md")) seenFilenames.add(f.replace(/\.md$/, ""));
  }

  let written = 0;
  for (const post of items) {
    if (!post || typeof post !== "object") continue;
    const link = getPostLink(post as Record<string, unknown>, blogUrl);
    if (!link) continue;
    const normalized = normalizePostUrl(link, blogUrl);
    if (seenUrls.has(normalized)) continue;
    seenUrls.add(normalized);

    const pubDate = parsePostDate(
      (post as Record<string, unknown>).published ??
        (post as Record<string, unknown>).pub_date ??
        (post as Record<string, unknown>).published_at ??
        (post as Record<string, unknown>).date
    );
    const dateStr = pubDate ? formatDate(pubDate) : "unknown";
    const title = getPostTitle(post as Record<string, unknown>);
    const slug = slugify(title);
    let baseName = `${dateStr}_${slug}`;
    if (seenFilenames.has(baseName)) {
      let n = 1;
      while (seenFilenames.has(`${baseName}-${n}`)) n++;
      baseName = `${baseName}-${n}`;
    }
    seenFilenames.add(baseName);

    const content = getPostContent(post as Record<string, unknown>);
    const meta = {
      title,
      link: normalized,
      published: pubDate ? pubDate.toISOString() : null,
      updated: pubDate ? pubDate.toISOString() : undefined,
      source,
      feedUrl,
      description: (content.slice(0, 500) !== content ? content.slice(0, 500) + "…" : content) || undefined,
      guid: getPostGuid(post as Record<string, unknown>, normalized),
    };

    const mdPath = join(postsDir, `${baseName}.md`);
    const mdContent = `# ${title}\n\n- **Published:** ${dateStr}\n- **Link:** ${normalized}\n\n${content}\n`;
    await writeFile(mdPath, mdContent, "utf-8");

    const metaPath = join(metadataDir, `${baseName}.json`);
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    written++;
  }

  return written;
}

async function main(): Promise<void> {
  const creatorPath = join(ROOT, "creator.json");
  const raw = await readFile(creatorPath, "utf-8");
  const creator: CreatorJson = JSON.parse(raw);

  const blogUrl = (creator.blogUrl || "").trim();
  if (!blogUrl) {
    console.error("creator.json must have blogUrl for blog-toolkit sync.");
    process.exit(1);
  }

  const outPath = join(ROOT, BLOG_TOOLKIT_OUTPUT);
  const isSubstack = blogUrl.includes("substack.com");
  const args = ["blog-toolkit", "pull", blogUrl, "-o", outPath, "--format", "json"];
  if (isSubstack) args.push("--method", "sitemap");
  const result = spawnSync("uvx", args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    console.error("blog-toolkit pull failed (exit code", result.status, ").");
    process.exit(result.status ?? 1);
  }

  const written = await ingestBlogToolkitJson(outPath, ROOT, creator);
  console.log("Synced", written, "posts from blog-toolkit.");
}

main();
