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
