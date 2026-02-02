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

/** Default branch when repo has no releases (fallback for update). */
export const TEMPLATE_DEFAULT_REF = "main";

/** Base URL for GitHub tarball. version can be a tag (e.g. 0.1.2 or v0.1.2) or a branch (e.g. main). */
export function getTemplateTarballUrl(version: string): string {
  const repo = getTemplateRepo();
  const ref = version.trim();
  // Branch refs: main, master. Tag refs: 0.1.2, v0.1.2
  if (ref === "main" || ref === "master" || ref === "HEAD") {
    return `https://github.com/${repo}/archive/refs/heads/main.tar.gz`;
  }
  if (ref === "master") {
    return `https://github.com/${repo}/archive/refs/heads/master.tar.gz`;
  }
  const tag = ref.startsWith("v") ? ref : `v${ref}`;
  return `https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`;
}
