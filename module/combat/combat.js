/**
 * @file System-level odifications to the way combat works
 */

/**
 * An extension of Foundry's Combat class that implements initiative for individual combatants.
 *
 * @todo Use a single chat card for rolling group initiative
 */
export class WWNCombat extends Combat {
  static FORMULA = "@initiativeRoll + @init";

  get #rerollBehavior() {
    return game.settings.get(game.system.id, "rerollInitiative");
  }

  // ===========================================================================
  // INITIATIVE MANAGEMENT
  // ===========================================================================

  async #rollAbsolutelyEveryone() {
    await this.rollInitiative(
      // this.combatants.map(c => c.id),
      // { formula: this.constructor.FORMULA }
    );
  }


  // ===========================================================================
  // COMBAT LIFECYCLE MANAGEMENT
  // ===========================================================================

  async startCombat() {
    await super.startCombat();
    if (this.#rerollBehavior !== "reset")
      await this.#rollAbsolutelyEveryone();
    return this;
  }

  async _onEndRound() {
    switch (this.#rerollBehavior) {
      case "reset":
        this.resetAll();
        break;
      case "reroll":
        this.#rollAbsolutelyEveryone();
        break;
      case "keep":
      default:
        break;
    }
    // @ts-expect-error - This method exists, but the types package doesn't have it
    await super._onEndRound();
    await this.activateCombatant(0)
  }

  async activateCombatant(turn) {
    if (game.user.isGM) {
      await game.combat.update({ turn });
    }
  }

async rollInitiative(ids = null) {
  const allCombatantsInContext = game.combat.combatants;
  let combatantsToRoll;

  if (ids === null) {
    combatantsToRoll = allCombatantsInContext;
  } else if (Array.isArray(ids)) {
    if (ids.length === 0) {
      return this; // No initiative to roll for an empty array
    }
    combatantsToRoll = allCombatantsInContext.filter(c => c && ids.includes(c.id));
  } else {
    console.warn("WWN | rollInitiative received 'ids' parameter that was not null and not an array. Defaulting to all combatants.", ids);
    combatantsToRoll = allCombatantsInContext;
  }

  if (!combatantsToRoll || combatantsToRoll.length === 0) {
    return this; // No combatants to roll for
  }

  const results = {};
  for (let combatant of combatantsToRoll) {
    if (!combatant || !combatant.id) {
      console.warn("WWN | Skipping combatant with no ID during initiative roll.");
      continue;
    }

    const combatantActor = combatant.actor;
    if (!combatantActor || !combatantActor.system) {
        console.warn(`WWN | Skipping combatant ${combatant.name} (${combatant.id}) due to missing actor or system data.`);
        continue;
    }

    const initiativeData = combatantActor.system.initiative;
    if (!initiativeData || typeof initiativeData.roll !== 'string' || typeof initiativeData.value !== 'number') {
      console.warn(`WWN | Skipping combatant ${combatant.name} (${combatant.id}) due to missing or invalid initiative data (roll: '${initiativeData?.roll}', value: '${initiativeData?.value}').`);
      continue;
    }

    try {
      const roll = new Roll(`${initiativeData.roll}+${initiativeData.value}`);
      const evaluatedRoll = await roll.evaluate();
      results[combatant.id] = {
        initiative: evaluatedRoll.total,
        roll: evaluatedRoll
      };
    } catch (error) {
      console.error(`WWN | Error rolling initiative for ${combatant.name} (${combatant.id}):`, error);
    }
  }

  if (Object.keys(results).length === 0) {
    return this; // No successful rolls
  }

  const updates = Object.keys(results).map(id => ({ _id: id, initiative: results[id].initiative }));
  await this.updateEmbeddedDocuments("Combatant", updates);
  await this.#rollInitiativeUIFeedback(results);
  // Consider if activateCombatant(0) is always desired or should depend on context
  await this.activateCombatant(0); 
  return this;
}

  async #rollInitiativeUIFeedback(results = {}) {
    const individualContentPromises = Object.entries(results).map(
      // #constructInitiativeOutputForIndividual is already async from the previous step
      ([id, result]) => this.#constructInitiativeOutputForIndividual(id, result.roll)
    );
    const individualContentStrings = await Promise.all(individualContentPromises);
    
    const combinedContent = individualContentStrings.join("\n");

    // Ensure chatData is an array with a single message object if we're combining all rolls into one message.
    // The original code's structure `content.map(c => {speaker, sound, content: c})` with `content` being an array of one string
    // effectively meant `ChatMessage.implementation.createDocuments` was called with an array containing one chat data object.
    if (combinedContent) { // Only create a message if there's content
      const chatMessageData = {
        speaker: { alias: game.i18n.localize("WWN.Initiative") },
        sound: CONFIG.sounds.dice,
        content: combinedContent
      };
      ChatMessage.implementation.createDocuments([chatMessageData]);
    }
  }

  async #constructInitiativeOutputForIndividual(id, roll) {
    const combatant = this.combatants.get(id);
    if (!combatant) return '';

    return `
    <p>${game.i18n.format("WWN.roll.initiative", { group: combatant.name })}
    <div class="dice-roll">   
      <div class="dice-result">
        <div class="dice-formula">${roll.formula}</div>
          <div class="dice-tooltip">
                ${await roll.getTooltip()}
              </div>
        <h4 class="dice-total">${roll.total}</h4>
      </div>
    </div>
  `;
  }

  // ===========================================================================
  // Randomize NPC HP
  // ===========================================================================
  static async preCreateToken(token, data, options, userId) {
    const actor = game.actors.get(data.actorId);
    const newData = {};

    if (!actor || data.actorLink || !game.settings.get("wwn", "randomHP")) {
      return token.updateSource(newData);
    }

    let newTotal = 0;
    const modSplit = token.actor.system.hp.hd.split("+");
    const dieSize = modSplit[0].split("d")[1];
    const dieCount = modSplit[0].split("d")[0];
    for (let i = 0; i < dieCount; i++) {
      newTotal += Math.floor(Math.random() * dieSize + 1);
    }
    newTotal += parseInt(modSplit[1]) || 0;

    foundry.utils.setProperty(newData, "delta.system.hp.value", newTotal);
    foundry.utils.setProperty(newData, "delta.system.hp.max", newTotal);

    return token.updateSource(newData);
  }
}
