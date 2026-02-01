/**
 * Feed discovery: HTML link-tag parsing and Content-Type validation.
 * Used by tooling when scaffolding creator repos (e.g. custom domains).
 */

import { getFeedCandidates } from "./feeds";

const RSS_ATOM_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
];

/** Match <link ... href="..." ...> with type/rel for feed. */
const LINK_RE = /<link\s([^>]*)\s*\/?>/gi;
const HREF_RE = /href\s*=\s*["']([^"']+)["']/i;
const TYPE_RE = /type\s*=\s*["']([^"']+)["']/i;
const REL_RE = /rel\s*=\s*["']([^"']+)["']/i;

function parseLinkTag(attrs: string, baseUrl: string): string | null {
  const hrefMatch = attrs.match(HREF_RE);
  const typeMatch = attrs.match(TYPE_RE);
  const relMatch = attrs.match(REL_RE);
  if (!hrefMatch) return null;
  const href = hrefMatch[1].trim();
  const typeVal = typeMatch?.[1]?.trim().toLowerCase();
  const relVal = relMatch?.[1]?.trim().toLowerCase();
  if (!typeVal || !RSS_ATOM_TYPES.some((t) => typeVal.includes(t))) return null;
  // Prefer rel="alternate" but allow missing rel (some feeds only have type)
  if (relVal && relVal !== "alternate" && !relVal.includes("alternate")) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Fetch blog page HTML and look for <link rel="alternate" type="application/rss+xml"> (or atom).
 * Returns first discovered feed URL or null.
 */
export async function discoverFeedFromHtml(blogUrl: string): Promise<string | null> {
  const normalized = blogUrl.trim();
  if (!normalized) return null;
  let base: string;
  try {
    base = new URL(normalized).href;
  } catch {
    return null;
  }
  try {
    const res = await fetch(base, { redirect: "follow" });
    const html = await res.text();
    let m: RegExpExecArray | null;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(html)) !== null) {
      const url = parseLinkTag(m[1], base);
      if (url) return url;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * HEAD (or GET) the URL; return true only if Content-Type suggests XML/RSS/Atom.
 */
export async function validateFeedUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) return true;
    // Some servers don't support HEAD or return different Content-Type for HEAD
    if (res.status >= 400) {
      const getRes = await fetch(url, { method: "GET", redirect: "follow" });
      const getCt = (getRes.headers.get("content-type") || "").toLowerCase();
      return getCt.includes("xml") || getCt.includes("rss") || getCt.includes("atom");
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Resolve feed URL for a blog: Substack uses /feed; custom domains try HTML discovery then candidates.
 */
export async function resolveFeedUrl(blogUrl: string): Promise<string> {
  const normalized = blogUrl.trim();
  if (!normalized) return "";

  try {
    const u = new URL(normalized);
    if (u.hostname.endsWith(".substack.com")) {
      u.pathname = "/feed";
      u.search = "";
      u.hash = "";
      return u.toString();
    }
  } catch {
    return "";
  }

  const fromHtml = await discoverFeedFromHtml(normalized);
  if (fromHtml && (await validateFeedUrl(fromHtml))) return fromHtml;

  const candidates = getFeedCandidates(normalized);
  for (const candidate of candidates) {
    if (await validateFeedUrl(candidate)) return candidate;
  }
  return getFeedCandidates(normalized)[0] || "";
}
