import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const listenerPath = path.join(root, "module/chat/chat-listener.mjs");

/** @type {readonly string[]} */
let WWN_CHAT_CARD_ACTIONS;

function parseOwnedActionsFromSource(src) {
  const block =
    src.match(/export const WWN_CHAT_CARD_ACTIONS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return Object.freeze([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

before(async () => {
  try {
    await import("../build/foundry-shim.mjs");
    ({ WWN_CHAT_CARD_ACTIONS } = await import("../module/chat/chat-listener.mjs"));
  } catch {
    const src = fs.readFileSync(listenerPath, "utf8");
    WWN_CHAT_CARD_ACTIONS = parseOwnedActionsFromSource(src);
  }
});

describe("ChatListener owned actions", () => {
  it("lists apply/heal actions and does not own expandRoll", () => {
    assert.ok(WWN_CHAT_CARD_ACTIONS.includes("applyRow"));
    assert.ok(WWN_CHAT_CARD_ACTIONS.includes("toggleHeal"));
    assert.ok(WWN_CHAT_CARD_ACTIONS.includes("applyPowerEffects"));
    assert.ok(WWN_CHAT_CARD_ACTIONS.includes("toggleDescription"));
    assert.equal(WWN_CHAT_CARD_ACTIONS.includes("expandRoll"), false);
  });

  it("returns before preventDefault for unknown actions", () => {
    const src = fs.readFileSync(listenerPath, "utf8");
    assert.match(src, /export const WWN_CHAT_CARD_ACTIONS/);
    const onAction = src.slice(src.indexOf("static async #onAction"));
    const preventIdx = onAction.indexOf("event.preventDefault");
    const guardIdx = onAction.search(/WWN_CHAT_CARD_ACTIONS\.(includes|has)/);
    assert.ok(guardIdx !== -1 && preventIdx !== -1 && guardIdx < preventIdx);
  });
});

describe("wwnChatRollRow lego", () => {
  it("is registered as a named Handlebars partial", () => {
    const registry = fs.readFileSync(path.join(root, "module/helpers/templates.mjs"), "utf8");
    assert.match(registry, /wwnChatRollRow:\s*"systems\/wwn\/templates\/chat\/roll-row\.hbs"/);
  });

  it("is a compact expandRoll table row with label, hint, detail, total, and tooltip", () => {
    const partial = fs.readFileSync(path.join(root, "templates/chat/roll-row.hbs"), "utf8");
    assert.match(partial, /<tbody/);
    assert.match(partial, /class="[^"]*dice-roll[^"]*wwn-chat-roll/);
    assert.match(partial, /data-action="expandRoll"/);
    assert.match(partial, /wwn-chat-roll-label-cell/);
    assert.match(partial, /wwn-chat-roll-total-cell/);
    assert.match(partial, /\{\{label\}\}/);
    assert.match(partial, /\{\{detail\}\}/);
    assert.match(partial, /\{\{total\}\}/);
    assert.match(partial, /\{\{\{tooltipHtml\}\}\}/);
    assert.match(partial, /data-tooltip="\{\{breakdown\}\}"/);
    assert.match(partial, /WWN\.Roll\.BreakdownHint/);
    const hintIdx = partial.indexOf("wwn-chat-hint");
    const totalCellIdx = partial.indexOf("wwn-chat-roll-total-cell");
    assert.ok(totalCellIdx !== -1 && hintIdx > totalCellIdx, "hint belongs in the total cell");
    assert.doesNotMatch(partial, /\stitle=/);
    assert.doesNotMatch(partial, /wwn-chat-roll-formula|\{\{formula\}\}/);
    const struckLabels = [...partial.matchAll(/wwn-chat-roll-label--struck[\s\S]*?<\/span>/g)];
    assert.equal(struckLabels.length, 2, "both roll-row branches strike only the label");
    for (const [chunk] of struckLabels) {
      assert.match(chunk, /\{\{label\}\}/);
      assert.doesNotMatch(chunk, /\{\{detail\}\}|\{\{total\}\}/);
    }
  });

  it("does not pair native title tooltips with Foundry data-tooltip on chat cards", () => {
    const chatDir = path.join(root, "templates/chat");
    for (const name of fs.readdirSync(chatDir).filter((f) => f.endsWith(".hbs"))) {
      const src = fs.readFileSync(path.join(chatDir, name), "utf8");
      assert.doesNotMatch(src, /data-tooltip[\s\S]{0,120}\stitle=/, `${name} must not set title next to data-tooltip`);
      assert.doesNotMatch(src, /\stitle=[\s\S]{0,120}data-tooltip/, `${name} must not set title next to data-tooltip`);
    }
  });

  it("renders rollRows from the shell instead of concatenating roll.render HTML", () => {
    const shell = fs.readFileSync(path.join(root, "templates/chat/card-shell.hbs"), "utf8");
    assert.match(shell, /<table class="wwn-chat-rolls">/);
    assert.doesNotMatch(shell, /leadNotices/);
    assert.match(shell, /wwn-chat-desc-drawer/);
    assert.match(shell, /toggleDescription/);
    assert.match(shell, /\{\{\{description\}\}\}/);
    const descIdx = shell.indexOf("wwn-chat-desc-drawer");
    const tableIdx = shell.indexOf('<table class="wwn-chat-rolls">');
    assert.ok(descIdx !== -1 && tableIdx !== -1 && descIdx < tableIdx, "description sits above the roll table");
    assert.match(shell, /\{\{#each rollRows\}\}/);
    assert.match(shell, /\{\{>\s*wwnChatRollRow/);
    assert.doesNotMatch(shell, /rollsHtml/);
  });

  it("factory builds rollRows from rolls and rollMeta", () => {
    const factory = fs.readFileSync(path.join(root, "module/chat/chat-card.mjs"), "utf8");
    assert.match(factory, /resolveChatMessageMode/);
    assert.match(factory, /buildRollRows/);
    assert.match(factory, /rollMeta/);
    assert.doesNotMatch(factory, /leadNotices/);
    assert.match(factory, /extraRollRows/);
    assert.match(factory, /description/);
    assert.doesNotMatch(factory, /roll\.render\(/);
  });
});

describe("chat card theme", () => {
  it("pins themed chat messages and compact rows to WWN tokens", () => {
    const css = fs.readFileSync(path.join(root, "scss/wwn/_chat-cards.scss"), "utf8");
    assert.match(css, /\.chat-message\.themed/);
    assert.match(css, /color-scheme:\s*var\(--color-scheme\)/);
    assert.match(css, /\.wwn-chat-roll/);
    assert.match(css, /\.wwn-chat-roll-summary/);
    assert.match(css, /\.wwn-chat-roll-label-cell/);
    assert.match(css, /\.wwn-chat-roll-total-cell/);
    assert.match(css, /justify-content:\s*flex-end/);
    assert.match(css, /display:\s*table-row-group/);
    assert.match(css, /\.wwn-chat-desc-drawer/);
    assert.match(css, /\.wwn-chat-outcome/);
    assert.match(css, /\.wwn-chat-natural-outcome/);
    assert.match(css, /&--critical/);
    assert.match(css, /&--fumble/);
    assert.match(css, /&\.collapsed/);
    assert.match(css, /rotate\(-90deg\)/);
    assert.match(css, /\.wwn-chat-title/);
    const titleCss = css.slice(css.indexOf(".wwn-chat-title"));
    assert.match(titleCss.slice(0, 200), /overflow-wrap:\s*anywhere|overflow-wrap:\s*break-word/);
    assert.doesNotMatch(titleCss.slice(0, 200), /white-space:\s*nowrap/);
    assert.doesNotMatch(titleCss.slice(0, 200), /text-overflow:\s*ellipsis/);
    assert.match(css, /font-size:\s*14px/);
    assert.match(css, /font-size:\s*16px/);
    assert.match(css, /--wwn-text/);
    assert.match(css, /--wwn-panel-bg|--wwn-border/);
    assert.doesNotMatch(css, /#666|#333/);
    const struck = css.slice(css.indexOf("wwn-chat-roll-label--struck"));
    assert.match(struck, /text-decoration:\s*line-through/);
  });

  it("paints the Foundry message with the opaque theme surface so dark-theme text is readable", () => {
    const css = fs.readFileSync(path.join(root, "scss/wwn/_chat-cards.scss"), "utf8");
    const themed = css.slice(css.indexOf(".chat-message.themed"));
    const block = themed.slice(0, themed.indexOf(".wwn-chat-card"));
    assert.match(block, /background:\s*var\(--wwn-bg-solid/);
    assert.match(block, /\.message-header/);
    assert.match(block, /--wwn-text/);
    assert.doesNotMatch(block, /--wwn-panel-bg/);
  });
});

describe("attack card rollMeta", () => {
  it("drops Attack/Damage breakdown headers from the body", () => {
    const body = fs.readFileSync(path.join(root, "templates/chat/attack-card.hbs"), "utf8");
    assert.doesNotMatch(body, /attackBreakdown/);
    assert.doesNotMatch(body, /damageBreakdown/);
    assert.match(body, /applyRows/);
    assert.match(body, /this\.suffix/);
    assert.match(body, /wwn-chat-outcome/);
    assert.match(body, /outcome\.label/);
    assert.match(body, /wwn-chat-natural-outcome/);
    assert.match(body, /naturalOutcome\.label/);
    assert.doesNotMatch(body, /trauma\.result/);
    const outcomeIdx = body.indexOf("wwn-chat-outcome");
    const applyIdx = body.indexOf("applyRows");
    assert.ok(outcomeIdx !== -1 && applyIdx !== -1 && outcomeIdx < applyIdx);
    assert.doesNotMatch(body, /wwn-chat-desc-drawer/);
    assert.doesNotMatch(body, /\{\{\{description\}\}\}/);
  });

  it("personal attacks pass rollMeta including Shock AC", () => {
    const src = fs.readFileSync(path.join(root, "module/dice/dice.mjs"), "utf8");
    const outcome = fs.readFileSync(path.join(root, "module/helpers/attack-outcome.mjs"), "utf8");
    assert.match(src, /rollMeta/);
    assert.match(src, /formatShockAcDetail/);
    assert.match(src, /WWN\.Roll\.ShockBase/);
    assert.match(src, /WWN\.Roll\.ShockApplySuffix/);
    assert.doesNotMatch(src, /leadNotices/);
    assert.match(src, /shouldEmitNoShockPlaceholder/);
    assert.match(src, /hasBaseShockDamage/);
    assert.match(src, /effectiveShockCompareAc/);
    assert.match(src, /enrichItemDescription/);
    assert.match(src, /extraRollRows/);
    assert.match(src, /buildNoShockRollRow/);
    assert.doesNotMatch(src, /WWN\.Roll\.NoShock/);
    assert.doesNotMatch(src, /WWN\.Roll\.ShockTargetAc/);
    assert.match(src, /resolveChatAttackTarget/);
    assert.match(outcome, /WWN\.Roll\.HitHeader|WWN\.Roll\.MissHeader/);
    assert.match(src, /formatAttackAcDetail/);
    assert.match(src, /formatTraumaDetail/);
    assert.match(outcome, /WWN\.Roll\.TraumaticHitHeader/);
    assert.match(src, /resolveAttackPresentation/);
    assert.match(src, /naturalOutcome/);
  });

  it("returns from a cancelled attack before spending ammo or rolling", () => {
    const src = fs.readFileSync(path.join(root, "module/dice/dice.mjs"), "utf8");
    const attack = src.slice(src.indexOf("static async rollAttack"), src.indexOf("static async rollDamage"));
    const cancelIdx = attack.indexOf('if (!result || result === "cancel") return;');
    const spendIdx = attack.indexOf("spendAttackAmmo");
    const evaluateIdx = attack.indexOf("new WwnAttackRoll");
    assert.ok(cancelIdx !== -1 && spendIdx !== -1 && evaluateIdx !== -1);
    assert.ok(cancelIdx < spendIdx && spendIdx < evaluateIdx);
  });

  it("power-armor attacks reuse the same exceeded-AC Shock row", () => {
    const src = fs.readFileSync(path.join(root, "module/helpers/power-armor-rolls.mjs"), "utf8");
    assert.match(src, /buildNoShockRollRow/);
    assert.match(src, /shouldEmitNoShockPlaceholder/);
    assert.match(src, /hasBaseShockDamage/);
    assert.match(src, /formatAttackAcDetail/);
    assert.doesNotMatch(src, /shockTotal:\s*null/);
    assert.doesNotMatch(src, /WWN\.Roll\.NoShock/);
  });

  it("localizes the exceeded-AC Shock hint", () => {
    const lang = JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8"));
    assert.equal(lang["WWN.Roll.ShockExceededHint"], "Target AC exceeds weapon's Shock AC value.");
  });
});

describe("simple roll cards", () => {
  it("does not show a Formula hint after the dice", () => {
    const src = fs.readFileSync(path.join(root, "templates/chat/simple-roll.hbs"), "utf8");
    assert.doesNotMatch(src, /breakdown/);
    assert.doesNotMatch(src, /WWN\.Roll\.Formula/);
  });

  it("skill, save, and check pass rollMeta instead of context.breakdown", () => {
    const dice = fs.readFileSync(path.join(root, "module/dice/dice.mjs"), "utf8");
    assert.equal((dice.match(/context:\s*\{\s*breakdown:/g) ?? []).length, 0);
    assert.match(dice, /rollMeta:/);
  });
});
