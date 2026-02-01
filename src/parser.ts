/**
 * Parser for blogger directory: discovers .md files and extracts Blog Name, Blog URL, Follow URL, Image URL.
 * Filename format: {Display Name} {32-char-hex}.md
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const BLOGGER_FILENAME_RE = /^(.+?)\s+([0-9a-f]{32})\.md$/i;

export interface Blogger {
  /** Display name from filename or # heading */
  displayName: string;
  /** Optional blog title */
  blogName: string | null;
  /** Canonical blog URL (Substack or custom) */
  blogUrl: string | null;
  /** Substack follow URL */
  followUrl: string | null;
  /** Optional image URL */
  imageUrl: string | null;
  /** 32-char hex id from filename (stable id) */
  hexId: string;
  /** Slug for repo/dir (safe filename from display name) */
  slug: string;
  /** Whether this entry has a Blog URL and can be synced */
  hasFeed: boolean;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "creator";
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const match = line.match(/^([^:]+):\s*(.*)$/);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

/**
 * Parse a single blogger .md file. Returns null if filename doesn't match expected pattern.
 */
export async function parseBloggerFile(filePath: string): Promise<Blogger | null> {
  const base = basename(filePath);
  const match = base.match(BLOGGER_FILENAME_RE);
  if (!match) return null;

  const [, nameFromFile, hexId] = match;
  const content = await readFile(filePath, "utf-8");
  const lines = content.split(/\r?\n/);

  let displayName = nameFromFile!.trim();
  let blogName: string | null = null;
  let blogUrl: string | null = null;
  let followUrl: string | null = null;
  let imageUrl: string | null = null;

  for (const line of lines) {
    const kv = parseKeyValue(line);
    if (!kv) continue;
    const key = kv.key.toLowerCase();
    if (key === "blog name") blogName = kv.value || null;
    else if (key === "blog url") blogUrl = kv.value || null;
    else if (key === "follow url") followUrl = kv.value || null;
    else if (key === "image url") imageUrl = kv.value || null;
  }

  // Use # heading as display name if present and we have no other name
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    const fromHeading = headingMatch[1].trim();
    if (fromHeading) displayName = fromHeading;
  }

  const hasFeed = !!blogUrl && blogUrl.length > 0;

  return {
    displayName,
    blogName,
    blogUrl,
    followUrl,
    imageUrl,
    hexId,
    slug: slugify(displayName),
    hasFeed,
  };
}

/**
 * Discover all blogger .md files in dataDir and parse them.
 * Returns only entries that match the filename pattern (name + 32-char hex).
 */
export async function parseBloggerDirectory(dataDir: string): Promise<Blogger[]> {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && BLOGGER_FILENAME_RE.test(e.name))
    .map((e) => join(dataDir, e.name));

  const results: Blogger[] = [];
  for (const file of files) {
    const blogger = await parseBloggerFile(file);
    if (blogger) results.push(blogger);
  }
  return results;
}

/**
 * Find a single blogger by hex id or display name (case-insensitive match on slug or display name).
 */
export function findBlogger(bloggers: Blogger[], idOrName: string): Blogger | undefined {
  const normalized = idOrName.trim().toLowerCase();
  const byHex = bloggers.find((b) => b.hexId.toLowerCase() === normalized);
  if (byHex) return byHex;
  const bySlug = bloggers.find((b) => b.slug === normalized || b.slug === slugify(idOrName));
  if (bySlug) return bySlug;
  return bloggers.find(
    (b) => b.displayName.toLowerCase() === normalized || b.displayName.toLowerCase().includes(normalized)
  );
}

/**
 * Build a Blogger from manual entry (display name, blog URL, optional follow URL and blog name).
 * Used by interactive "Enter manually" flow.
 */
export function bloggerFromManual(
  displayName: string,
  blogUrl: string,
  followUrl?: string,
  blogName?: string
): Blogger {
  const slug = slugify(displayName);
  const hexId = createHash("sha256").update(blogUrl.trim()).digest("hex").slice(0, 32);
  return {
    displayName: displayName.trim(),
    blogName: blogName?.trim() ?? null,
    blogUrl: blogUrl.trim() || null,
    followUrl: followUrl?.trim() ?? null,
    imageUrl: null,
    hexId,
    slug,
    hasFeed: !!blogUrl?.trim(),
  };
}
