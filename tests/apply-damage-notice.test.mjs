/**
 * Apply-damage chat notice (token apply feedback).
 * Run: node --test tests/apply-damage-notice.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApplyDamageNotice } from "../module/chat/apply-damage-notice.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("buildApplyDamageNotice", () => {
  it("titles damage with the floored applied amount and lists names", () => {
    const notice = buildApplyDamageNotice(7, 1, ["Goblin", "Alak"]);
    assert.equal(notice.title, "Applied 7 damage");
    assert.equal(notice.img, "icons/svg/blood.svg");
    assert.deepEqual(notice.list, ["Goblin", "Alak"]);
  });

  it("titles healing when the signed amount is negative", () => {
    const notice = buildApplyDamageNotice(-8, 1, ["Anak"]);
    assert.equal(notice.title, "Applied 8 healing");
    assert.equal(notice.img, "icons/svg/heal.svg");
    assert.deepEqual(notice.list, ["Anak"]);
  });

  it("applies the card multiplier before flooring", () => {
    assert.equal(buildApplyDamageNotice(5, 2, ["X"]).title, "Applied 10 damage");
    assert.equal(buildApplyDamageNotice(5, 0.5, ["X"]).title, "Applied 2 damage");
  });
});

describe("chat apply wiring", () => {
  it("posts the apply-damage notice from card apply buttons", () => {
    const src = fs.readFileSync(path.join(root, "module/chat/chat-listener.mjs"), "utf8");
    assert.match(src, /buildApplyDamageNotice/);
    assert.match(src, /createNoticeMessage/);
  });
});
