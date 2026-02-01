/**
 * Resolve RSS/Atom feed URL from a blog URL.
 * Substack: {blogUrl}/feed
 * Custom domain: try common paths (/feed, /feed.xml, /rss, /atom.xml)
 */

const SUBSTACK_HOST = "substack.com";

/**
 * Returns true if url is a Substack publication URL (e.g. https://foo.substack.com/ or https://substack.com/@foo).
 */
export function isSubstackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith(".substack.com") || u.hostname === "substack.com";
  } catch {
    return false;
  }
}

/**
 * Get the primary feed URL for a blog. For Substack we know it's /feed.
 * For custom domains we return the first path to try; discovery can validate later.
 */
export function getFeedUrl(blogUrl: string): string {
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
    // Custom domain: default to /feed (most common)
    u.pathname = u.pathname === "/" || u.pathname === "" ? "/feed" : u.pathname.replace(/\/?$/, "") + "/feed";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

/** Common feed paths to try for custom domains (without leading slash; base URL has trailing slash or path). */
export const CUSTOM_FEED_PATHS = ["feed", "feed.xml", "rss", "rss.xml", "atom.xml", "index.xml"];

/**
 * Return a list of candidate feed URLs for a blog URL. First is the preferred one.
 */
export function getFeedCandidates(blogUrl: string): string[] {
  const normalized = blogUrl.trim();
  if (!normalized) return [];

  try {
    const u = new URL(normalized);
    const base = u.origin + (u.pathname === "/" || u.pathname === "" ? "" : u.pathname.replace(/\/?$/, ""));

    if (u.hostname.endsWith(".substack.com")) {
      return [`${base}/feed`];
    }

    return CUSTOM_FEED_PATHS.map((path) => `${base}/${path}`);
  } catch {
    return [];
  }
}
