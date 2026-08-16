/**
 * Group saving throws from attack/power chat cards.
 * One modifier dialog (global + per-token overrides), one results card,
 * and buttons to select the tokens that succeeded or failed.
 */

/**
 * @param {HTMLFormElement} form
 * @returns {{ globalModifier: string, overrides: Record<string, string> }}
 */
export function parseGroupSaveForm(form) {
  const globalModifier = form.querySelector('[name="globalModifier"]')?.value ?? "0";
  const overrides = {};
  for (const input of form.querySelectorAll("[name^='modifier-']")) {
    overrides[input.name.slice("modifier-".length)] = input.value;
  }
  return { globalModifier, overrides };
}

/**
 * Individual override (including an explicit 0) replaces the global modifier.
 * Empty / missing override uses the global value.
 *
 * @param {{ globalModifier?: string|number, overrides?: Record<string, string|number|null|undefined> }} form
 * @param {{ id: string }[]} tokens
 * @returns {Record<string, number>}
 */
export function resolveTokenModifiers(form, tokens) {
  const global = Number(form.globalModifier) || 0;
  const overrides = form.overrides ?? {};
  const modifiers = {};
  for (const token of tokens) {
    const raw = overrides[token.id];
    const hasOverride = raw !== "" && raw != null;
    modifiers[token.id] = hasOverride ? Number(raw) || 0 : global;
  }
  return modifiers;
}

/** @returns {{ isSuccess: boolean, isFailure: boolean }} */
export function evaluateSaveOutcome(total, target) {
  const isSuccess = Number(total) >= Number(target);
  return { isSuccess, isFailure: !isSuccess };
}

export function formatSaveRollDetail({ total, target }) {
  return `${total} vs ${target}`;
}

export function buildSaveResult({ name, tokenId, total, target, modifier = 0 }) {
  const { isSuccess, isFailure } = evaluateSaveOutcome(total, target);
  return {
    name,
    tokenId,
    total,
    target,
    modifier: Number(modifier) || 0,
    isSuccess,
    isFailure,
    detail: formatSaveRollDetail({ total, modifier, target }),
  };
}

export function sortSaveResults(results) {
  return [...results].sort((a, b) => b.total - a.total);
}

export function partitionSaveResults(results) {
  return {
    successful: results.filter((r) => r.isSuccess),
    failed: results.filter((r) => r.isFailure),
  };
}

export function tokenRef(token) {
  const id = token.id;
  const sceneId = token.scene?.id ?? token.document?.parent?.id ?? null;
  return sceneId ? `${sceneId}.${id}` : id;
}

export function parseTokenRef(ref) {
  if (!ref) return null;
  const i = String(ref).indexOf(".");
  if (i === -1) return { sceneId: null, tokenId: String(ref) };
  return { sceneId: String(ref).slice(0, i), tokenId: String(ref).slice(i + 1) };
}

function tokenMatchesRef(token, parsed) {
  if (!parsed) return false;
  if (token.id !== parsed.tokenId) return false;
  if (!parsed.sceneId) return true;
  const sceneId = token.scene?.id ?? token.document?.parent?.id ?? null;
  return !sceneId || sceneId === parsed.sceneId;
}

export function findTokensByRefs(refs, placeables) {
  const found = [];
  for (const ref of refs ?? []) {
    const parsed = parseTokenRef(ref);
    const token = (placeables ?? []).find((t) => tokenMatchesRef(t, parsed));
    if (token) found.push(token);
  }
  return found;
}

export function buildGroupSaveCardContext(results) {
  const { successful, failed } = partitionSaveResults(results);
  return {
    results,
    successful,
    failed,
    hasSuccessfulSaves: successful.length > 0,
    hasFailedSaves: failed.length > 0,
    successfulTokenIds: successful.map((r) => r.tokenId),
    failedTokenIds: failed.map((r) => r.tokenId),
  };
}

export function selectSaveGroupTokens(group, message, placeables) {
  const key = group === "failed" ? "failedTokenIds" : "successfulTokenIds";
  const refs = message.getFlag?.("wwn", key) ?? message.flags?.wwn?.[key] ?? [];
  return findTokensByRefs(refs, placeables);
}

export function controlCanvasTokens(tokens) {
  if (!tokens?.length) {
    ui.notifications.warn(game.i18n.localize("WWN.Chat.NoTokensOnScene"));
    return;
  }
  canvas.tokens.releaseAll();
  for (const token of tokens) token.control({ releaseOthers: false });
  ui.notifications.info(game.i18n.format("WWN.Chat.SelectedTokens", { count: tokens.length }));
}

/**
 * Prompt for a global modifier plus optional per-token overrides.
 * @returns {Promise<{ globalModifier: string, overrides: Record<string, string> }|null>}
 */
export async function promptGroupSave({ tokens, saveLabel }) {
  const { showWwnDialog, cancelButton } = await import("../applications/wwn-dialog.mjs");
  return showWwnDialog({
    modifier: "group-save",
    title: game.i18n.format("WWN.Chat.GroupSavesTitle", { save: saveLabel }),
    template: "systems/wwn/templates/dialog/group-save.hbs",
    context: {
      tokens: tokens.map((t) => ({ id: t.id, name: t.name })),
    },
    buttons: [
      {
        action: "roll",
        icon: "fa-solid fa-dice-d20",
        label: "WWN.Dialog.Roll",
        default: true,
        callback: (_event, button) => parseGroupSaveForm(button.form),
      },
      cancelButton(),
    ],
  });
}

/**
 * Evaluate one 1d20 save per token.
 * @returns {Promise<{ results: object[], rolls: Roll[], rollMeta: object[] }>}
 */
export async function rollGroupSaves({ tokens, saveId, modifiers }) {
  const { RollParts } = await import("../dice/roll-parts.mjs");
  const { WwnRoll } = await import("../dice/rolls.mjs");
  const results = [];
  const rolls = [];
  const rollMeta = [];
  for (const token of tokens) {
    const actor = token.actor;
    const save = actor?.system?.saves?.[saveId];
    if (!save) continue;
    const modifier = modifiers[token.id] ?? 0;
    const parts = new RollParts().add("1d20", game.i18n.localize("WWN.Roll.Die"));
    parts.add(modifier, game.i18n.localize("WWN.Roll.Situational"));
    const roll = await new WwnRoll(parts.formula(), actor.getRollData?.() ?? {}, { kind: "save" }).evaluate();
    results.push(buildSaveResult({
      name: token.name,
      tokenId: tokenRef(token),
      total: roll.total,
      target: save.value,
      modifier,
    }));
    rolls.push(roll);
    rollMeta.push({
      label: token.name,
      breakdown: parts.breakdown(),
    });
  }
  return { results: sortSaveResults(results), rolls, rollMeta };
}

export async function postGroupSaveCard({ saveId, saveLabel, results, rolls, rollMeta }) {
  const { createRollMessage } = await import("./chat-card.mjs");
  const ctx = buildGroupSaveCardContext(results);
  return createRollMessage({
    rolls,
    rollMeta,
    kind: "group-save",
    title: game.i18n.format("WWN.Chat.GroupSavesTitle", { save: saveLabel }),
    bodyTemplate: "systems/wwn/templates/chat/group-save-body.hbs",
    context: ctx,
    flags: {
      saveId,
      successfulTokenIds: ctx.successfulTokenIds,
      failedTokenIds: ctx.failedTokenIds,
    },
  });
}

/**
 * Full chat-card save flow: dialog → rolls → grouped results card.
 */
export async function rollCardGroupSave(tokens, saveId) {
  const first = tokens.find((t) => t.actor?.system?.saves?.[saveId]);
  if (!first) {
    ui.notifications.warn(game.i18n.localize("WWN.Chat.ApplyDenied"));
    return;
  }
  const saveLabel = game.i18n.localize(first.actor.system.saves[saveId].label ?? saveId);
  const form = await promptGroupSave({ tokens, saveLabel });
  if (!form) return;
  const modifiers = resolveTokenModifiers(form, tokens);
  const { results, rolls, rollMeta } = await rollGroupSaves({ tokens, saveId, modifiers });
  if (!results.length) return;
  return postGroupSaveCard({ saveId, saveLabel, results, rolls, rollMeta });
}
