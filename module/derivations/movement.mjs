import { isPc } from "../helpers/actor-types.mjs";

/**
 * Movement derivation: combat / exploration speeds from base, with optional
 * encumbrance-driven auto-calculation (PCs only). B/X also derives daily
 * miles as exploration / 5. Must run after encumbrance derivation.
 *
 * One encumbrance step is +2 Readied or +4 Stowed (they add). 0 = full speed,
 * 1 = light, 2 = heavy, 3+ = immobile.
 */

const RATE_ALIASES = Object.freeze({ movewwn: "feet", movebx: "bx" });
const DEFAULT_FEET = Object.freeze([30, 20, 15]);

/**
 * @param {string|null|undefined} key
 * @returns {string}
 */
export function normalizeMovementRateKey(key) {
  return RATE_ALIASES[key] ?? key ?? "feet";
}

/**
 * B/X lists wilderness miles/day. Feet and Meters do not.
 * @param {string|null|undefined} [key]
 * @returns {boolean}
 */
export function usesDailyTravel(key) {
  const rate = key ?? game.settings.get("wwn", "movementRate");
  return normalizeMovementRateKey(rate) === "bx";
}

/**
 * @param {{ value?: unknown, max?: unknown }} readied
 * @param {{ value?: unknown, max?: unknown }} stowed
 * @returns {number}
 */
export function encumbranceSteps(readied, stowed) {
  const readyOver = Math.max(0, Number(readied.value) - Number(readied.max));
  const stowedOver = Math.max(0, Number(stowed.value) - Number(stowed.max));
  return Math.ceil(readyOver / 2) + Math.ceil(stowedOver / 4);
}

/**
 * @param {string} rateKey
 * @returns {number[]}
 */
function encounterTiers(rateKey) {
  const rates = CONFIG.WWN?.movementRates ?? {};
  const key = normalizeMovementRateKey(rateKey);
  return rates[key] ?? rates.feet ?? rates.movewwn ?? DEFAULT_FEET;
}

/**
 * @param {Actor} actor
 */
export function deriveMovement(actor) {
  const system = actor.system;
  const movement = system.movement;
  const bonus = movement.bonus ?? 0;
  const rateKey = game.settings.get("wwn", "movementRate");

  let encounterBase = (movement.base?.value ?? 30) + bonus;

  if (isPc(actor) && game.settings.get("wwn", "showMovement") && system.encumbrance) {
    const encounter = encounterTiers(rateKey);
    const steps = encumbranceSteps(system.encumbrance.readied, system.encumbrance.stowed);
    encounterBase = steps > 2 ? 0 : encounter[steps] + bonus;
  }

  movement.combat = encounterBase;
  movement.exploration = encounterBase * 3;
  movement.daily = usesDailyTravel(rateKey) ? encounterBase * 3 / 5 : null;
}
