import { WWN } from "../config.js";
import { WWNGroupCombat } from "./combat-group.js";
import WWNCombatGroupSelector from "./combat-set-groups.js";

export class WWNCombatTab extends CombatTracker {
  // ===========================================================================
  // APPLICATION SETUP
  // ===========================================================================

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: 'systems/wwn/templates/sidebar/combat-tracker.hbs',
    });
  }

  static GROUP_CONFIG_APP = new WWNCombatGroupSelector();


  // ===========================================================================
  // RENDERING
  // ===========================================================================

  async getData(options) {
    const context = await super.getData(options);
    const isGroupInitiative = game.settings.get(game.system.id, "initiative") === "group";

    const turns = context.turns.map((turn) => {
      const combatant = game.combat.combatants.get(turn.id);
      turn.isOwnedByUser = !!combatant.actor.isOwner;
      turn.group = combatant.group;
      return turn;
    });

    const groups = turns.reduce((arr, turn) => {
      const idx = arr.findIndex(r => r.group === turn.group);

      if (idx !== -1) {
        arr[idx].turns.push(turn);
        return arr;
      }

      return [...arr, {
        group: turn.group,
        label: WWNGroupCombat.GROUPS[turn.group],
        initiative: turn.initiative,
        turns: [turn]
      }];
    }, []);

    return foundry.utils.mergeObject(context, {
      turns,
      groups,
      isGroupInitiative
    })
  }


  // ===========================================================================
  // UI EVENTS
  // ===========================================================================

  activateListeners(html) {
    super.activateListeners(html);
    const trackerHeader = html.find("#combat > header");

    // Reroll group initiative
    html.find('.combat-button[data-control="reroll"]').click((ev) => {
      game.combat.rollInitiative();
    });

    html.find('.combat-button[data-control="set-groups"]').click((ev) => {
      WWNCombatTab.GROUP_CONFIG_APP.render(true, { focus: true });
    });
  }

  async #toggleFlag(combatant, flag) {
    const isActive = !!combatant.getFlag(game.system.id, flag);
    await combatant.setFlag(game.system.id, flag, !isActive);
  }

  /**
   * Handle a Combatant control toggle
   * @private
   * @param {Event} event   The originating mousedown event
   */
  async _onCombatantControl(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget;
    const li = btn.closest(".combatant");
    const combat = this.viewed; // this.viewed is the current Combat encounter
    const combatantId = li.dataset.combatantId;
    // const c = combat.combatants.get(combatantId); // c is not used in the new logic, can be removed if not needed for other controls

    // Check if the specific control for individual initiative roll was clicked
    if (btn.dataset.control === "rollInitiative") {
      if (combatantId && combat) {
        // Call our custom rollInitiative with the specific combatant's ID
        await combat.rollInitiative([combatantId]);
      }
      // Do not call super._onCombatantControl(event) here as we've handled it.
      // The event's default action and propagation are already stopped.
      return; 
    }

    // For any other combatant controls, fall back to the default FoundryVTT behavior
    return super._onCombatantControl(event);
  }

  // ===========================================================================
  // ADDITIONS TO THE COMBATANT CONTEXT MENU
  // ===========================================================================

  _getEntryContextOptions() {
    const options = super._getEntryContextOptions();
    return [
      {
        name: game.i18n.localize("WWN.combat.SetCombatantAsActive"),
        icon: '<i class="fas fa-star-of-life"></i>',
        callback: (li) => {
          const combatantId = li.data('combatant-id')
          const turnToActivate = this.viewed.turns.findIndex(t => t.id === combatantId);
          this.viewed.activateCombatant(turnToActivate);
        }
      },
      ...options
    ];
  }
}