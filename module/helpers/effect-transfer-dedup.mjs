/**
 * Detect actor-side copies of item transfer effects (Foundry v14 yields both).
 * Scene/day power clones use origin = item UUID and must still apply.
 *
 * @param {Actor|{ items?: Iterable }} actor
 * @param {ActiveEffect|{ origin?: string, name?: string, id?: string, flags?: object }} effect
 * @returns {boolean}
 */
export function isDuplicateOfItemTransfer(actor, effect) {
  if (effect?.flags?.wwn?.powerEffect) return false;
  const origin = effect?.origin;
  if (!origin) return false;
  for (const item of actor?.items ?? []) {
    for (const itemEffect of item.effects ?? []) {
      if (!itemEffect.transfer) continue;
      if (itemEffect.id && itemEffect.id === effect.id) return true;
      if (origin === itemEffect.uuid) return true;
    }
  }
  return false;
}
