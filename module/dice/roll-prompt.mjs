/**
 * Shared roll-dialog helpers (attribute pick + situational modifier).
 */

/**
 * @param {Actor|{ system?: { abilities?: object } }|null} actor
 * @param {string} selectedKey
 * @param {{ abilities?: Record<string, string>, localize?: (key: string) => string }} [options]
 * @returns {{ key: string, label: string, selected: boolean }[]}
 */
export function skillRollAbilityChoices(actor, selectedKey, { abilities, localize } = {}) {
  const scores = actor?.system?.abilities;
  if (!scores || typeof scores !== "object") return [];

  const table = abilities ?? globalThis.CONFIG?.WWN?.abilities ?? {};
  const loc = localize ?? ((key) => globalThis.game?.i18n?.localize?.(key) ?? key);
  return Object.keys(table).map((key) => ({
    key,
    label: loc(table[key]),
    selected: key === selectedKey,
  }));
}

/**
 * @param {object|string|null} result
 * @param {{ defaultAbilityKey?: string|null }} [options]
 * @returns {{ modifier: number, abilityKey: string|null }|null}
 */
export function parseRollDialogResult(result, { defaultAbilityKey = null } = {}) {
  if (!result || result === "cancel") return null;
  const chosen = String(result.abilityKey ?? "").trim();
  return {
    modifier: Number(result.modifier) || 0,
    abilityKey: chosen || defaultAbilityKey || null,
  };
}
