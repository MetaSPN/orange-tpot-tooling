/**
 * Sync script for creator repo: reads creator.json, fetches feed(s), writes posts/ and metadata/.
 * Supplements RSS with Substack /archive crawl when blog is Substack (RSS is ~20 posts only).
 * Run from creator repo root: bun run scripts/sync-posts.ts
 */

import Parser from "rss-parser";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface CreatorJson {
  displayName: string;
  blogName?: string | null;
  blogUrl?: string | null;
  followUrl?: string | null;
  feedUrls: string[];
  slug: string;
  supplementStrategy?: "none" | "substack_archive" | "browser";
}

interface RssItemExtended {
  content?: string;
  contentEncoded?: string;
  contentSnippet?: string;
  summary?: string;
  description?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  title?: string;
  [key: string]: unknown;
}

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
    u.search = u.search || ""; // keep query if present
    let path = u.pathname.replace(/\/$/, "") || "/";
    u.pathname = path;
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** Content priority: content (encoded) → snippet → summary → description. */
function getItemContent(item: RssItemExtended): string {
  const raw =
    item.content ??
    (item as RssItemExtended).contentEncoded ??
    item.contentSnippet ??
    item.summary ??
    item.description;
  return (typeof raw === "string" ? raw : "") || "See link for full content.";
}

/** Pub date with fallback and invalid-date guard. */
function getItemPubDate(item: RssItemExtended): Date | null {
  const raw = item.pubDate ?? (item as RssItemExtended).updated;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Extract /p/ post URLs from Substack archive HTML (best-effort, no browser). Exclude /p/slug/comments etc. */
function extractSubstackPostUrls(html: string, archiveBaseUrl: string): string[] {
  const seen = new Set<string>();
  const base = archiveBaseUrl.replace(/\/?$/, "");
  const origin = new URL(base).origin;

  // 1) Match href="..."/p/... or href='...'/p/...
  const hrefRe = /href\s*=\s*["']([^"']*\/p\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const u = new URL(raw, base);
      if (!u.pathname.includes("/p/")) continue;
      const match = u.pathname.match(/^\/p\/([^/]+)\/?$/);
      if (!match) continue;
      u.hash = "";
      u.pathname = `/p/${match[1]}`;
      u.search = "";
      const normalized = u.toString();
      if (!seen.has(normalized)) seen.add(normalized);
    } catch {
      // skip invalid
    }
  }

  // 2) Fallback: find /p/slug anywhere in HTML (e.g. in JSON or data), exclude /p/slug/comments
  const slugRe = /\/p\/([^/"'\s]+)/g;
  while ((m = slugRe.exec(html)) !== null) {
    const slug = m[1];
    if (!slug || slug === "comments") continue;
    try {
      const normalized = `${origin}/p/${slug}`;
      if (!seen.has(normalized)) seen.add(normalized);
    } catch {
      // skip
    }
  }

  return [...seen];
}

/** Slug from Substack post path: /p/slug-here -> slug-here */
function slugFromSubstackPath(url: string): string {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/p\/([^/]+)/);
    return match ? slugify(match[1]) : slugify(url);
  } catch {
    return slugify(url);
  }
}

async function main() {
  const creatorPath = join(ROOT, "creator.json");
  const raw = await readFile(creatorPath, "utf-8");
  const creator: CreatorJson = JSON.parse(raw);
  const feedUrls = Array.isArray(creator.feedUrls) ? creator.feedUrls : [creator.feedUrls].filter(Boolean);
  if (feedUrls.length === 0) {
    console.error("No feedUrls in creator.json");
    process.exit(1);
  }

  await mkdir(join(ROOT, "posts"), { recursive: true });
  await mkdir(join(ROOT, "metadata"), { recursive: true });

  const parser = new Parser({
    customFields: {
      item: [["content:encoded", "contentEncoded"]],
    },
  });

  // URL-first dedup: load existing posts by URL and by filename
  const seenUrls = new Set<string>();
  const seenFilenames = new Set<string>();
  const metadataDir = join(ROOT, "metadata");
  const postsDir = join(ROOT, "posts");
  const existingMeta = await readdir(metadataDir).catch(() => []);
  for (const f of existingMeta) {
    if (!f.endsWith(".json")) continue;
    try {
      const metaRaw = await readFile(join(metadataDir, f), "utf-8");
      const meta = JSON.parse(metaRaw);
      if (meta.link) seenUrls.add(normalizePostUrl(meta.link));
    } catch {
      // ignore
    }
  }
  const existingPosts = await readdir(postsDir).catch(() => []);
  for (const f of existingPosts) {
    if (f.endsWith(".md")) seenFilenames.add(f.replace(/\.md$/, ""));
  }

  const source = creator.blogUrl?.includes("substack.com") ? "substack" : "blog";
  let writtenRss = 0;

  // --- RSS phase ---
  for (const feedUrl of feedUrls) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const feedLink = feed.link ? normalizePostUrl(feed.link, feedUrl) : feedUrl;
      for (const item of feed.items || []) {
        const rawLink = item.link || item.guid;
        if (!rawLink) continue;
        const link = normalizePostUrl(rawLink, feedLink);
        if (seenUrls.has(link)) continue;
        seenUrls.add(link);

        const pubDate = getItemPubDate(item as RssItemExtended);
        const dateStr = pubDate ? formatDate(pubDate) : "unknown";
        const title = (item.title || "Untitled").trim();
        const slug = slugify(title);
        let baseName = `${dateStr}_${slug}`;
        if (seenFilenames.has(baseName)) {
          let n = 1;
          while (seenFilenames.has(`${baseName}-${n}`)) n++;
          baseName = `${baseName}-${n}`;
        }
        seenFilenames.add(baseName);

        const content = getItemContent(item as RssItemExtended);
        const meta = {
          title,
          link,
          published: pubDate ? pubDate.toISOString() : null,
          updated: pubDate ? pubDate.toISOString() : undefined,
          source,
          feedUrl,
          description: (item.contentSnippet ?? item.summary ?? item.description)?.slice(0, 500) || undefined,
          guid: item.guid || link,
        };

        const mdPath = join(ROOT, "posts", `${baseName}.md`);
        const mdContent = `# ${title}\n\n- **Published:** ${dateStr}\n- **Link:** ${link}\n\n${content}\n`;
        await writeFile(mdPath, mdContent, "utf-8");

        const metaPath = join(ROOT, "metadata", `${baseName}.json`);
        await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
        writtenRss++;
      }
    } catch (err) {
      console.error(`Failed to fetch ${feedUrl}:`, err);
    }
  }

  // --- Substack archive supplement ---
  let writtenArchive = 0;
  const blogUrl = (creator.blogUrl || "").trim();
  const isSubstack = blogUrl.includes("substack.com");
  const strategy = creator.supplementStrategy ?? (isSubstack ? "substack_archive" : "none");
  if (isSubstack && strategy === "substack_archive") {
    try {
      const archiveUrl = new URL("/archive", blogUrl).href;
      const res = await fetch(archiveUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const html = await res.text();
      const postUrls = extractSubstackPostUrls(html, archiveUrl);
      for (const postUrl of postUrls) {
        const normalized = normalizePostUrl(postUrl, blogUrl);
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);

        const slug = slugFromSubstackPath(postUrl);
        const baseName = `unknown_${slug}`;
        let finalBase = baseName;
        if (seenFilenames.has(finalBase)) {
          let n = 1;
          while (seenFilenames.has(`${baseName}-${n}`)) n++;
          finalBase = `${baseName}-${n}`;
        }
        seenFilenames.add(finalBase);

        const meta = {
          title: "Untitled",
          link: normalized,
          published: null,
          source: "substack",
          feedUrl: feedUrls[0],
          guid: normalized,
          supplement: true,
        };

        const mdPath = join(ROOT, "posts", `${finalBase}.md`);
        const mdContent = `# Untitled\n\n- **Published:** unknown\n- **Link:** ${normalized}\n\nSee link for full content.\n`;
        await writeFile(mdPath, mdContent, "utf-8");

        const metaPath = join(ROOT, "metadata", `${finalBase}.json`);
        await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
        writtenArchive++;
      }
    } catch (err) {
      console.error("Substack archive fetch failed:", err);
    }
  }

  console.log(`Synced ${writtenRss} from RSS; ${writtenArchive} from archive.`);
}

main();
