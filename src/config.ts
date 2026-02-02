/**
 * Config: default master list URL and env/override resolution.
 * Default points at this repo's data/creators.json (raw GitHub).
 */

export const DEFAULT_MASTER_LIST_URL =
  "https://raw.githubusercontent.com/metaspn/orange-tpot-tooling/main/data/creators.json";

export function getMasterListUrl(override?: string): string {
  if (override && override.trim()) return override.trim();
  const env = process.env?.ORANGE_TPOT_MASTER_LIST_URL || process.env?.ORANGE_TPOT_LIST_URL;
  if (env && env.trim()) return env.trim();
  return DEFAULT_MASTER_LIST_URL;
}

/** Template repo for update-from-template (owner/repo). */
export const TEMPLATE_REPO = "metaspn/orange-tpot-tooling";

export function getTemplateRepo(override?: string): string {
  if (override && override.trim()) return override.trim();
  const env = process.env?.ORANGE_TPOT_TEMPLATE_REPO;
  if (env && env.trim()) return env.trim();
  return TEMPLATE_REPO;
}

/** Base URL for GitHub API and tarballs. */
export function getTemplateTarballUrl(version: string): string {
  const repo = getTemplateRepo();
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`;
}
