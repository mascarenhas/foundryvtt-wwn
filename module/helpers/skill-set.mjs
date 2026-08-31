/**
 * Resolve the world skill-set setting to the matching skills pack.
 */

const NS = "wwn";
const DEFAULT_KEY = "wwn";

/** @returns {{ primarySlugs: string[], secondarySlugs: string[], allSlugs: string[], labels: Record<string, string> }} */
const emptyCache = () => ({ primarySlugs: [], secondarySlugs: [], allSlugs: [], labels: {} });

/**
 * Sync cache for roll data / sheet dropdowns. Refreshed on ready and when skillSet changes.
 * @type {{ primarySlugs: string[], secondarySlugs: string[], allSlugs: string[], labels: Record<string, string> }}
 */
let skillSetCache = emptyCache();

/**
 * @returns {{ primarySlugs: string[], secondarySlugs: string[], allSlugs: string[], labels: Record<string, string> }}
 */
export function getSkillSetCache() {
  return skillSetCache;
}

/**
 * Reload primary/secondary skill metadata from the active pack into the sync cache.
 * @param {object} [options]
 * @param {boolean} [options.notify=false]
 * @returns {Promise<typeof skillSetCache>}
 */
export async function refreshSkillSetCache({ notify = false } = {}) {
  const docs = await loadSkillSetDocuments({ notify });
  const next = emptyCache();
  for (const i of docs) {
    if (i.type !== "skill") continue;
    const slug = skillSlugOf(i);
    if (!slug) continue;
    next.allSlugs.push(slug);
    next.labels[slug] = i.name;
    if (i.system?.secondary === true) {
      next.secondarySlugs.push(slug);
      continue;
    }
    next.primarySlugs.push(slug);
  }
  skillSetCache = next;
  if (CONFIG.WWN) CONFIG.WWN.skillSetCache = next;
  return next;
}

/**
 * @returns {"wwn"|"swn"|"awn"|"cwn"}
 */
export function getSkillSetKey() {
  const key = game.settings.get(NS, "skillSet");
  if (key === "swn" || key === "awn" || key === "wwn" || key === "cwn") return key;
  return DEFAULT_KEY;
}

/**
 * @param {string} [key]
 * @returns {string}
 */
export function getSkillSetPackId(key = getSkillSetKey()) {
  return CONFIG.WWN.skillSetPacks?.[key] ?? CONFIG.WWN.skillSetPacks[DEFAULT_KEY];
}

/**
 * @param {string} [key]
 * @returns {CompendiumCollection|null}
 */
export function getSkillSetPack(key = getSkillSetKey()) {
  return game.packs.get(getSkillSetPackId(key)) ?? null;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.notify=true]
 * @returns {Promise<Item[]>}
 */
export async function loadSkillSetDocuments({ notify = true } = {}) {
  const pack = getSkillSetPack();
  if (!pack) {
    if (notify) {
      ui.notifications?.error?.(game.i18n.localize("WWN.Setting.SkillSetPackMissing"));
    }
    return [];
  }
  return pack.getDocuments();
}

/**
 * Formula / pack key from the skill's current name (`@sunblade`, bonus-skill lists).
 * @param {{ type?: string, name?: string }} item
 * @returns {string}
 */
export function skillSlugOf(item) {
  const name = String(item?.name ?? "").trim();
  if (!name) return "";
  if (typeof name.slugify === "function") {
    return name.slugify({ strict: true }).replace(/-/g, "");
  }
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Clone pack skill data for embedding on an actor (new id, no folder).
 * @param {Iterable<{ type?: string, toObject?: Function }>} docs
 * @param {string} slug
 * @returns {object|null}
 */
export function skillCreateDataFromPackDocs(docs, slug) {
  const normalized = String(slug ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const doc = [...docs].find((i) => i?.type === "skill" && skillSlugOf(i) === normalized);
  if (!doc) return null;
  const data = typeof doc.toObject === "function"
    ? doc.toObject()
    : foundry.utils.deepClone(doc);
  delete data._id;
  delete data.folder;
  delete data._key;
  delete data._stats;
  return data;
}

/**
 * @param {string} slug
 * @param {object} [options]
 * @param {boolean} [options.notify=false]
 * @returns {Promise<object|null>}
 */
export async function getSkillCreateDataBySlug(slug, { notify = false } = {}) {
  const docs = await loadSkillSetDocuments({ notify });
  return skillCreateDataFromPackDocs(docs, slug);
}

/**
 * Primary (non-secondary) skill item data for seeding / Add Skills.
 * @param {object} [options]
 * @param {boolean} [options.notify=true]
 * @returns {Promise<object[]>}
 */
export async function getPrimarySkillData({ notify = true } = {}) {
  const docs = await loadSkillSetDocuments({ notify });
  const primary = docs
    .filter((i) => i.type === "skill" && i.system?.secondary !== true)
    .map((i) => i.toObject());
  if (!primary.length && notify) {
    ui.notifications?.warn?.(game.i18n.localize("WWN.Setting.SkillSetEmpty"));
  }
  return primary;
}

/**
 * Slug → display name for focus pickers / dropdowns (primary skills only).
 * @param {object} [options]
 * @param {boolean} [options.notify=false]
 * @returns {Promise<Record<string, string>>}
 */
export async function getSkillLabelChoices({ notify = false } = {}) {
  await refreshSkillSetCache({ notify });
  return { ...skillSetCache.labels };
}
