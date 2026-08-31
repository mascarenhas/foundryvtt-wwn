import { isNpc } from "../helpers/actor-types.mjs";

/**
 * Random HP for unlinked NPC tokens when they are created on the canvas.
 * Dice must be rolled asynchronously after the token exists.
 */

/**
 * @param {{ enabled?: boolean, actor?: { type?: string }|null, actorLink?: boolean }} args
 * @returns {boolean}
 */
export function shouldApplyRandomNpcHp({ enabled, actor, actorLink }) {
  return Boolean(enabled) && Boolean(actor) && isNpc(actor) && actorLink !== true;
}

/**
 * @param {{ system?: { hd?: string } }} actor
 * @returns {string}
 */
export function npcHdFormula(actor) {
  return String(actor?.system?.hd || "1d8");
}

/**
 * @param {number} total
 * @returns {{ "system.hp.value": number, "system.hp.max": number }}
 */
export function randomNpcHpUpdates(total) {
  return {
    "system.hp.value": total,
    "system.hp.max": total,
  };
}

/**
 * Register the canvas token-create hook.
 */
export function registerRandomHpHook() {
  Hooks.on("createToken", async (tokenDocument, _options, userId) => {
    if (userId !== game.user.id) return;
    if (!game.settings.get("wwn", "randomHP")) return;

    const tokenActor = tokenDocument.actor;
    const sourceActor = tokenDocument.baseActor ?? tokenActor;
    if (!shouldApplyRandomNpcHp({
      enabled: true,
      actor: sourceActor,
      actorLink: tokenDocument.actorLink,
    })) return;
    // Never write HP onto the world prototype — only the unlinked token actor.
    if (!tokenActor || tokenDocument.actorLink) return;

    const formula = npcHdFormula(sourceActor);
    try {
      const roll = await new Roll(formula).evaluate();
      await tokenActor.update(randomNpcHpUpdates(roll.total));
    } catch (err) {
      console.warn(`WWN | Could not roll random HP for ${tokenActor.name}: ${err.message}`);
    }
  });
}
