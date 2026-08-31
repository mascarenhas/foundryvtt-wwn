/**
 * Actor AE de-dupe must skip transferred copies, not scene/day power clones.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDuplicateOfItemTransfer } from "../module/helpers/effect-transfer-dedup.mjs";

function actorWithItemEffect({ itemUuid, effectUuid, name, transfer = true }) {
  return {
    items: [{
      uuid: itemUuid,
      effects: [{
        id: "itemFx",
        uuid: effectUuid,
        name,
        transfer,
      }],
    }],
  };
}

describe("isDuplicateOfItemTransfer", () => {
  it("skips an actor copy whose origin is the item effect UUID", () => {
    const actor = actorWithItemEffect({
      itemUuid: "Item.abc",
      effectUuid: "Item.abc.ActiveEffect.fx1",
      name: "Buff",
    });
    const actorEffect = {
      origin: "Item.abc.ActiveEffect.fx1",
      name: "Buff",
      flags: {},
    };
    assert.equal(isDuplicateOfItemTransfer(actor, actorEffect), true);
  });

  it("does not skip a scene/day power clone (origin is the item UUID)", () => {
    const actor = actorWithItemEffect({
      itemUuid: "Item.art",
      effectUuid: "Item.art.ActiveEffect.fx1",
      name: "Cold Flesh",
    });
    const clone = {
      origin: "Item.art",
      name: "Cold Flesh",
      transfer: false,
      flags: { wwn: { powerEffect: true } },
    };
    assert.equal(isDuplicateOfItemTransfer(actor, clone), false);
  });

  it("does not skip a same-named actor AE that only shares the item UUID", () => {
    const actor = actorWithItemEffect({
      itemUuid: "Item.abc",
      effectUuid: "Item.abc.ActiveEffect.fx1",
      name: "Buff",
    });
    const gmEffect = {
      origin: "Item.abc",
      name: "Buff",
      flags: {},
    };
    assert.equal(isDuplicateOfItemTransfer(actor, gmEffect), false);
  });
});
