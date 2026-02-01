/**
 * Scaffold a creator repo: copy templates, substitute placeholders, ensure posts/ and metadata/ exist.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Blogger } from "./parser";
import { getFeedUrl, isSubstackUrl } from "./feeds";
import { resolveFeedUrl } from "./feed-discovery";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates", "creator");

export async function substituteCreatorVarsAsync(content: string, blogger: Blogger): Promise<string> {
  const blogName = blogger.blogName ?? blogger.displayName;
  const blogUrl = blogger.blogUrl ?? "";
  const followUrl = blogger.followUrl ?? "";
  const imageUrl = blogger.imageUrl ?? "";
  let feedUrls: string[] = [];
  if (blogUrl) {
    if (isSubstackUrl(blogUrl)) {
      feedUrls = [getFeedUrl(blogUrl)];
    } else {
      const discovered = await resolveFeedUrl(blogUrl);
      feedUrls = discovered ? [discovered] : [getFeedUrl(blogUrl)];
    }
  }
  const feedUrlsJson = JSON.stringify(feedUrls);
  const supplementStrategy = isSubstackUrl(blogUrl) ? "substack_archive" : "none";
  return content
    .replace(/\{\{displayName\}\}/g, blogger.displayName)
    .replace(/\{\{blogName\}\}/g, blogName)
    .replace(/\{\{blogUrl\}\}/g, blogUrl)
    .replace(/\{\{followUrl\}\}/g, followUrl)
    .replace(/\{\{imageUrl\}\}/g, imageUrl)
    .replace(/\{\{feedUrlsJson\}\}/g, feedUrlsJson)
    .replace(/\{\{slug\}\}/g, blogger.slug)
    .replace(/\{\{hexId\}\}/g, blogger.hexId)
    .replace(/\{\{supplementStrategy\}\}/g, supplementStrategy);
}

export function substituteCreatorVars(content: string, blogger: Blogger): string {
  const blogName = blogger.blogName ?? blogger.displayName;
  const blogUrl = blogger.blogUrl ?? "";
  const followUrl = blogger.followUrl ?? "";
  const imageUrl = blogger.imageUrl ?? "";
  const feedUrls = blogUrl ? [getFeedUrl(blogUrl)] : [];
  const feedUrlsJson = JSON.stringify(feedUrls);
  const supplementStrategy = isSubstackUrl(blogUrl) ? "substack_archive" : "none";

  return content
    .replace(/\{\{displayName\}\}/g, blogger.displayName)
    .replace(/\{\{blogName\}\}/g, blogName)
    .replace(/\{\{blogUrl\}\}/g, blogUrl)
    .replace(/\{\{followUrl\}\}/g, followUrl)
    .replace(/\{\{imageUrl\}\}/g, imageUrl)
    .replace(/\{\{feedUrlsJson\}\}/g, feedUrlsJson)
    .replace(/\{\{slug\}\}/g, blogger.slug)
    .replace(/\{\{hexId\}\}/g, blogger.hexId)
    .replace(/\{\{supplementStrategy\}\}/g, supplementStrategy);
}

async function copyDirRecursive(
  src: string,
  dest: string,
  blogger: Blogger,
  substitute: (s: string) => Promise<string> | string
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = join(src, e.name);
    const destPath = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDirRecursive(srcPath, destPath, blogger, substitute);
    } else {
      let content = await readFile(srcPath, "utf-8");
      if (e.name.endsWith(".md") || e.name.endsWith(".json") || e.name.endsWith(".yml")) {
        content = await (typeof substitute(content) === "string" ? Promise.resolve(substitute(content)) : substitute(content));
      }
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content, "utf-8");
    }
  }
}

/**
 * Scaffold a creator repo at outputDir (e.g. ./creators/holly-elmore).
 * Uses blogger data for placeholders. For custom domains, optionally discovers feed URL via HTML; for Substack uses /feed and supplementStrategy substack_archive.
 */
export async function scaffoldCreatorRepo(blogger: Blogger, outputDir: string, options?: { discoverFeed?: boolean }): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const substitute = options?.discoverFeed
    ? (c: string) => substituteCreatorVarsAsync(c, blogger)
    : (c: string) => substituteCreatorVars(c, blogger);
  await copyDirRecursive(TEMPLATES_DIR, outputDir, blogger, substitute);
  await mkdir(join(outputDir, "posts"), { recursive: true });
  await mkdir(join(outputDir, "metadata"), { recursive: true });
}
