import {
  migrateActorData,
  migrateItemData,
  migrateActorItems,
  applyEmbeddedItemMigration,
  isBarePlaceholderActorData,
  isKnownAmmoItem,
  collectWeaponAmmoNeedles,
  gearMatchesAmmoNeedle,
  repairWwnWeaponFirearm,
  repairWwnArmorTlMagical,
} from "./transforms.mjs";
import { mergeWeaponFavorites } from "../helpers/favorites.mjs";
import { isNpc, isPc } from "../helpers/actor-types.mjs";
import { remapAssetPath } from "./asset-map.mjs";
import { maybeSyncPcCompendiumItems } from "./pc-compendium-sync.mjs";
import { maybeCleanupClassAbilities, repairInvalidEmbeddedItems } from "./class-ability-cleanup.mjs";
import { embeddedItemsNeedReplace } from "./embedded-items.mjs";

const NS = "wwn";

/** Legacy item types that the server cannot instantiate (not in system.json). */
const LEGACY_ITEM_TYPES = new Set(["art", "spell", "ability"]);

/** Versions below this trigger migration. Bump when adding steps. */
const NEEDS_MIGRATION_BELOW = "2.0.0-alpha2.3";

/** Marks the one Actor-level effect synthesized while loading legacy tweak fields. */
const LEGACY_TWEAK_EFFECT_MIGRATION = "legacyTweaks";

/**
 * Plain-ish item source from a world/embedded Item document.
 * @param {Item|object} item
 */
function itemSource(item) {
  return typeof item?.toObject === "function" ? item.toObject() : item;
}

/**
 * Whether an item list still needs gear→ammo, hurlant firearm, or armor TL/magical backfill.
 * @param {Iterable} items
 */
function itemsNeedAmmoOrFirearmMigration(items) {
  const list = [...(items ?? [])].map(itemSource);
  if (list.some((i) => isKnownAmmoItem(i))) return true;
  if (list.some((i) => repairWwnWeaponFirearm(i))) return true;
  if (list.some((i) => repairWwnArmorTlMagical(i))) return true;
  const needles = collectWeaponAmmoNeedles(list);
  if (needles.ids.size || needles.fallbacks.length) {
    if (list.some((i) => gearMatchesAmmoNeedle(i, needles))) return true;
  }
  return false;
}

/** @param {any} value */
function forcedReplace(value) {
  return foundry.data.operators.ForcedReplacement.create(value);
}

/**
 * Check the world's migration version on ready and run migration if needed.
 * Also runs one-shot PC compendium item sync when that flag is still unset.
 */
export async function checkMigration() {
  if (!game.user.isGM) return;
  const current = game.settings.get(NS, "systemMigrationVersion");
  const needsVersionMigrate =
    !current || foundry.utils.isNewerVersion(NEEDS_MIGRATION_BELOW, current);

  if (needsVersionMigrate) {
    // Shape / item signals only — actor types stay character/monster forever.
    const needsWork =
      game.actors.some((a) => a.system?.scores) ||
      game.actors.some(
        (a) => isPc(a) && a.system?.combat?.ab !== undefined && a.system?.combat?.abMod === undefined
      ) ||
      game.actors.some((a) => isNpc(a) && a.system?.hp?.hd && !a.system?.hd) ||
      game.items.some((i) => ["art", "spell", "ability"].includes(i.type)) ||
      game.items.some((i) => i.type === "armor" && i.system?.traumaTargetMod !== undefined) ||
      game.items.some(
        (i) =>
          i.type === "power"
          && i.system?.internalResourceLength
          && !["scene", "day"].includes(i.system.internalResourceLength)
      ) ||
      // World directory items (Item.migrateData does not gear→ammo).
      itemsNeedAmmoOrFirearmMigration(game.items) ||
      [...game.actors].some((a) => itemsNeedAmmoOrFirearmMigration(a.items)) ||
      game.actors.invalidDocumentIds.size > 0 ||
      game.items.invalidDocumentIds.size > 0 ||
      [...game.actors].some((a) =>
        [...(a.items?.invalidDocumentIds ?? [])].length > 0
        || [...a.items].some((i) => LEGACY_ITEM_TYPES.has(i.type))
      );
    // Actor.migrateData can hide embedded ammo/firearm/Art-link work on live
    // docs; force a persisted actor system/item pass when crossing into this
    // release.
    const forceReleasePass = !current || foundry.utils.isNewerVersion(NEEDS_MIGRATION_BELOW, current);
    if (!needsWork && !forceReleasePass) {
      await game.settings.set(NS, "systemMigrationVersion", game.system.version);
    } else {
      await migrateWorld({ forcePersist: forceReleasePass });
    }
  }

  // Refresh stale PC foci/classEdges/powers from system packs when sync generation is behind.
  await maybeSyncPcCompendiumItems();

  // One-shot: archive retired Class Ability foci, strip Full Warrior AE, flag class assignment.
  await maybeCleanupClassAbilities();

  // Drop corrupt embedded items left without name/type (blocks actor load otherwise).
  await repairInvalidEmbeddedItems();
}

/**
 * Migrate all world actors, items, unlinked scene token actors, and unlocked
 * world Actor/Item packs. Linked tokens use their world Actor (already covered).
 * Idempotent: documents already in WWN shape pass through unchanged.
 */
export async function migrateWorld({ forcePersist = false } = {}) {
  ui.notifications.info(
    game.i18n.format("WWN.Migration.Started", { version: game.system.version }),
    { permanent: false }
  );

  // Foundry dismisses non-permanent notifications after Notifications.LIFETIME_MS
  // (5s). Re-ping at 5.5s so a replacement appears shortly after each fades.
  const stillMigrating = window.setInterval(() => {
    ui.notifications.info(game.i18n.localize("WWN.Migration.StillRunning"), {
      permanent: false,
      console: false,
    });
  }, 5500);

  game.wwn ??= {};
  game.wwn.migrating = true;

  let failures = 0;
  try {
    console.info("WWN | Migration: starting world items…");
    let itemCount = 0;
    for (const item of allDocuments(game.items)) {
      try {
        await migrateWorldItem(item);
        itemCount++;
      } catch (err) {
        failures++;
        console.error(`WWN | Item migration failed for ${item.name}:`, err);
      }
    }
    console.info(`WWN | Migration: world items done (${itemCount}). Starting actors…`);

    for (const actor of allDocuments(game.actors)) {
      try {
        console.info(`WWN | Migration: starting actor ${actor.name}`);
        await migrateActorDocument(actor, { forcePersist });
        console.info(`${actor.name}-- Migration Complete`);
      } catch (err) {
        failures++;
        console.error(`WWN | Actor migration failed for ${actor.name}:`, err);
      }
    }
    console.info("WWN | Migration: world actors done. Migrating unlinked scene tokens…");
    for (const scene of game.scenes ?? []) {
      for (const token of scene.tokens ?? []) {
        if (token.actorLink) continue;
        const actor = token.actor;
        if (!actor) continue;
        try {
          console.info(`WWN | Migration: starting token actor ${actor.name} on scene ${scene.name}`);
          await migrateUnlinkedToken(token, { forcePersist });
          console.info(`${actor.name}-- Token Migration Complete`);
        } catch (err) {
          failures++;
          console.error(
            `WWN | Token actor migration failed for ${actor.name} on ${scene.name}:`,
            err
          );
        }
      }
    }
    console.info("WWN | Migration: scene tokens done. Checking world packs…");

    for (const pack of game.packs) {
      if (pack.metadata.packageType !== "world") continue;
      if (!["Actor", "Item"].includes(pack.documentName)) continue;
      if (pack.locked) continue;
      console.info(`WWN | Migration: pack ${pack.collection}…`);
      await pack.getDocuments(); // populates the collection + invalid bucket
      for (const doc of allDocuments(pack)) {
        try {
          if (pack.documentName === "Item") {
            await migrateWorldItem(doc);
          } else {
            console.info(`WWN | Migration: starting pack actor ${doc.name}`);
            await migrateActorDocument(doc, { forcePersist });
            console.info(`${doc.name}-- Migration Complete`);
          }
        } catch (err) {
          failures++;
          console.error(`WWN | Pack migration failed for ${doc.name}:`, err);
        }
      }
    }

    console.info("WWN | Migration: post-steps (compendium sync, class cleanup)…");
    if (failures === 0) {
      await game.settings.set(NS, "systemMigrationVersion", game.system.version);
    } else {
      console.warn(`WWN | Migration finished with ${failures} failure(s); version stamp skipped.`);
    }
    await maybeSyncPcCompendiumItems();
    await maybeCleanupClassAbilities();
    console.info("WWN | Migration: all steps finished.");
  } finally {
    game.wwn.migrating = false;
    window.clearInterval(stillMigrating);
  }

  if (failures > 0) {
    ui.notifications.error(
      game.i18n.format("WWN.Migration.Failed", { count: failures }),
      { permanent: true }
    );
  } else {
    ui.notifications.info(
      game.i18n.format("WWN.Migration.Complete", { version: game.system.version }),
      { permanent: true }
    );
  }

  const parkedWounds = [...game.actors].filter((a) => a.getFlag?.(NS, "legacyWounds")).length;
  if (parkedWounds > 0) {
    ui.notifications.warn(game.i18n.localize("WWN.Migration.LegacyWoundsParked"), {
      permanent: true,
    });
  }
}

/**
 * World-level Item: type changes (art→power) must recreate — the server cannot
 * updateSource on a document whose stored type is no longer in system.json.
 * @param {Item} item
 */
export async function migrateWorldItem(item) {
  const raw = item.toObject();
  const pending = !!item.getFlag?.(NS, "pendingTypeMigration");
  const migrated = applyEmbeddedItemMigration(raw);
  const needsRecreate =
    pending
    || LEGACY_ITEM_TYPES.has(raw.type)
    || (migrated.type && migrated.type !== raw.type);

  if (needsRecreate) {
    const keepId = item.id;
    const pack = item.pack || null;
    const folder = item.folder?.id ?? item.folder ?? null;
    // Snapshot the pre-migration source so a failed recreate can restore the original.
    const backup = foundry.utils.deepClone({ ...raw, _id: keepId, folder });
    foundry.utils.setProperty(migrated, `flags.${NS}.pendingTypeMigration`, null);
    const payload = { ...migrated, _id: keepId, folder };
    await item.delete({ wwnMigrating: true });
    try {
      const created = await CONFIG.Item.documentClass.create(payload, {
        keepId: true,
        pack,
        wwnMigrating: true,
      });
      if (!created) throw new Error("create returned empty");
    } catch (err) {
      console.error(`WWN | Recreate failed for ${backup.name} (${keepId}); restoring backup:`, err);
      await CONFIG.Item.documentClass.create(backup, {
        keepId: true,
        pack,
        wwnMigrating: true,
      });
      throw err;
    }
    return;
  }

  const data = migrateItemData(raw);
  if (!data) return;
  const fullReplacement = data.type != null && data.system != null && data.name != null;
  // Partial system patches must merge recursively so unrelated fields survive.
  // Full legacy transforms deliberately replace their supplied top-level data
  // so omitted legacy system/effect fields are removed.
  await item.update(data, {
    enforceTypes: false,
    diff: false,
    ...(fullReplacement ? { recursive: false } : {}),
    wwnMigrating: true,
  });
}

/**
 * Iterate a DocumentCollection's valid documents plus its invalid ones.
 * Legacy item types (`art`, ...) may fail schema validation and live in the
 * invalid bucket; actor types stay character/monster (with pc/npc aliases).
 */
function* allDocuments(collection) {
  yield* collection.contents;
  for (const id of collection.invalidDocumentIds) {
    const doc = collection.getInvalid(id, { strict: false });
    if (doc) yield doc;
  }
}

/**
 * Decide what an actor migration must write after Foundry has already run
 * Document.migrateData in memory. The release pass deliberately persists the
 * canonical actor system and embedded-item sources even when applying the pure
 * transform again is a no-op.
 */
export function actorMigrationPersistencePlan({
  forcePersist = false,
  bare = false,
  rawSystem,
  result,
  itemsChanged = false,
} = {}) {
  const systemChanged = result?.system !== null && result?.system !== undefined;
  const shouldPersist = forcePersist || systemChanged || itemsChanged;
  return {
    shouldPersist,
    system: result?.system ?? (forcePersist ? rawSystem : null),
    effects: bare ? null : (result?.effects ?? null),
    items: !bare && (forcePersist || itemsChanged) ? (result?.items ?? []) : null,
  };
}

/**
 * Migrate a single Actor document in place (system shape + embedded items).
 * Does not change actor type.
 */
export async function migrateActorDocument(
  actor,
  { forcePersist = false, persistItems = true } = {}
) {
  if (actor.type === "faction") return; // out of scope — leave untouched

  // Fast path: already canonical shape, no embedded content to fix.
  if (
    !forcePersist
    && (isPc(actor) || isNpc(actor))
    && !actor.items?.size
    && !(actor.items?.invalidDocumentIds?.size)
    && !actor.effects?.size
    && !actor.system?.scores
    && !(isNpc(actor) && actor.system?.hp?.hd && !actor.system?.hd)
  ) {
    return;
  }

  const raw = actor.toObject();
  const itemSources = collectEmbeddedItemSources(actor, raw);
  raw.items = itemSources;
  const bare = isBarePlaceholderActorData(raw, itemSources);

  const result = migrateActorData(raw);
  if (!result) {
    if (!bare && persistItems) {
      const replaced = await replaceEmbeddedItemsIfNeeded(actor, itemSources);
      if (replaced) await finalizeActorMigrationHooks(actor);
    }
    return;
  }

  const itemsChanged = !bare && embeddedItemsNeedReplace(itemSources, result.items);
  const persistence = actorMigrationPersistencePlan({
    forcePersist,
    bare,
    rawSystem: raw.system,
    result,
    // Synthetic Token actors persist their collection through Token.delta,
    // never by replacing the full effective inventory on the ephemeral Actor.
    itemsChanged: persistItems && itemsChanged,
  });
  if (!persistItems) persistence.items = null;

  if (!persistence.shouldPersist) {
    if (!bare && isNpc(actor)) await ensureNpcWeaponFavorites(actor);
    return;
  }

  const legacyWounds =
    raw.system?.hp?.injuries != null || raw.system?.hp?.wounds != null
      ? {
          injuries: raw.system.hp.injuries ?? null,
          wounds: raw.system.hp.wounds ?? null,
        }
      : null;
  if (legacyWounds) {
    console.info(
      `WWN | ${actor.name}: injuries/wounds parked under flags.wwn.legacyWounds (wound modules own live data).`
    );
  }

  const tokenSrc = foundry.utils.getProperty(raw, "prototypeToken.texture.src");
  const newTokenSrc = remapAssetPath(tokenSrc);

  await persistActorMigration(actor, {
    // Document.migrateData has already normalized the live source before
    // ready. On a release pass, persist that canonical system/item source even
    // when the pure transform now appears idempotent, otherwise the database
    // stays old.
    system: persistence.system,
    img: result.img && result.img !== actor.img ? result.img : undefined,
    tokenSrc: newTokenSrc !== tokenSrc ? newTokenSrc : undefined,
    effects: persistence.effects,
    items: persistence.items,
    bare,
    legacyWounds,
  });

  if (!bare && isNpc(actor)) await ensureNpcWeaponFavorites(actor);
  if (persistence.items !== null) await finalizeActorMigrationHooks(actor);
}

/**
 * Persist an unlinked Token actor without copying its full synthetic inventory
 * into the ActorDelta. The delta is the durable, base-relative boundary; only
 * entries already owned by that delta are written back.
 * @param {TokenDocument} token
 * @param {{ forcePersist?: boolean }} options
 */
export async function migrateUnlinkedToken(token, { forcePersist = false } = {}) {
  const actor = token?.actor;
  const delta = token?.delta;
  if (!actor || !delta) return;

  const deltaItems = collectActorDeltaItemSources(delta);

  // Actor.update correctly computes sparse system/effect changes for a
  // synthetic Actor. Its embedded Item collection needs separate handling.
  await migrateActorDocument(actor, { forcePersist, persistItems: false });

  const migratedActor = token.actor ?? actor;
  const actorRaw = migratedActor.toObject();
  const effectiveItems = collectEmbeddedItemSources(migratedActor, actorRaw);
  const canonicalDeltaItems = buildActorDeltaItemMigration(deltaItems, effectiveItems);
  const itemsChanged =
    JSON.stringify(deltaItems) !== JSON.stringify(canonicalDeltaItems);

  if (forcePersist || itemsChanged) {
    // Arrays are full replacements under Foundry update semantics. Do not use
    // ForcedReplacement here: ActorDelta.items is an EmbeddedCollectionDelta
    // whose tombstones and base-relative ownership must remain intact.
    await token.update(
      { delta: { items: canonicalDeltaItems } },
      { enforceTypes: false, diff: false, wwnMigrating: true }
    );
  }

  if (forcePersist || itemsChanged) {
    const refreshedActor = token.actor ?? migratedActor;
    await finalizeActorMigrationHooks(refreshedActor);
  }
}

/**
 * Read only the Item entries managed by an ActorDelta, including tombstones.
 * @param {ActorDelta} delta
 * @returns {object[]}
 */
function collectActorDeltaItemSources(delta) {
  const source = Array.isArray(delta?._source?.items) ? delta._source.items : [];
  const byId = new Map();
  for (const item of source) {
    if (!item?._id) continue;
    byId.set(item._id, foundry.utils.deepClone(item));
  }
  return Array.from(byId.values());
}

/**
 * Canonicalize delta-owned Items against the full synthetic inventory while
 * preserving deletion tombstones and excluding inherited base-only Items.
 * @param {object[]} deltaItems
 * @param {object[]} effectiveItems
 * @returns {object[]}
 */
export function buildActorDeltaItemMigration(deltaItems, effectiveItems) {
  const canonicalEffective = migrateActorItems(
    (effectiveItems ?? []).filter((item) => !item?._tombstone)
  );
  const effectiveById = new Map(
    canonicalEffective.filter((item) => item?._id).map((item) => [item._id, item])
  );

  const migrated = [];
  for (const source of deltaItems ?? []) {
    if (source?._tombstone) {
      migrated.push(foundry.utils.deepClone(source));
      continue;
    }
    const canonical = effectiveById.get(source?._id);
    if (canonical) {
      migrated.push(foundry.utils.deepClone(canonical));
      continue;
    }
    const [fallback] = migrateActorItems([source]);
    // Some migration steps deliberately retire an embedded Item. Omitting it
    // from the replacement delta array removes the delta-owned row as well.
    if (fallback) migrated.push(foundry.utils.deepClone(fallback));
  }
  return migrated;
}

/**
 * Run focus/power sync that was skipped during embedded item clear/recreate hooks.
 * @param {Actor} actor
 */
async function finalizeActorMigrationHooks(actor) {
  console.info(`WWN | ${actor.name}: post-item focus/power sync…`);
  const { syncPowerTransferEffects } = await import("../helpers/power-effects.mjs");
  for (const power of actor.items.filter((i) => i.type === "power")) {
    await syncPowerTransferEffects(power);
  }
  if (!isPc(actor)) return;
  const { syncActorFocusBonusSkills } = await import("../helpers/focus-bonus-skills.mjs");
  const { syncActorPowerBonusSkills } = await import("../helpers/power-bonus-skills.mjs");
  const { syncActorFocusEffects } = await import("../helpers/focus-effects.mjs");
  await syncActorFocusEffects(actor);
  await syncActorFocusBonusSkills(actor);
  await syncActorPowerBonusSkills(actor);
}

/**
 * Persist remapped system/items via update (never changes actor type).
 * Effects are applied surgically — never ForcedReplace the whole collection
 * (that races item clear/recreate and tries to delete transferred AEs).
 * @param {Actor} actor
 * @param {{
 *   system?: object|null,
 *   img?: string,
 *   tokenSrc?: string,
 *   effects?: object[]|null,
 *   items?: object[]|null,
 *   bare?: boolean,
 *   legacyWounds?: { injuries?: unknown, wounds?: unknown }|null,
 * }} data
 */
async function persistActorMigration(actor, data) {
  const label = actor.name ?? actor.id;
  const update = {};
  if (data.system != null) update.system = forcedReplace(data.system);
  if (data.img) update.img = data.img;
  if (data.tokenSrc) update["prototypeToken.texture.src"] = data.tokenSrc;
  if (data.legacyWounds) update[`flags.${NS}.legacyWounds`] = data.legacyWounds;

  if (data.effects?.length && !data.bare) {
    console.info(`WWN | ${label}: persisting effects…`);
    // A pre-ready migration effect is synthesized from fields that the system
    // replacement removes. Store it first so a failed create remains safely
    // retryable from the still-legacy actor source.
    await persistActorEffectMigrations(actor, data.effects);
  }

  if (Object.keys(update).length) {
    console.info(`WWN | ${label}: persisting system…`);
    // ForcedReplacement already expresses exact replacement. Combining it
    // with recursive:false makes Foundry wrap top-level values in a second
    // operator, which breaks TypeDataField and synthetic Token actors.
    await actor.update(update, { enforceTypes: false, diff: false, wwnMigrating: true });
  }

  if (data.items == null) return;

  const migratedItems = migrateActorItems(data.items);
  await replaceEmbeddedItemsSafely(actor, migratedItems);
}

/**
 * Create/update actor-owned effects from migration output without wiping the collection.
 * @param {Actor} actor
 * @param {object[]} effects
 */
async function persistActorEffectMigrations(actor, effects) {
  const sourceById = new Map((actor._source?.effects ?? []).map((e) => [e._id, e]));
  const toCreate = [];
  const toUpdate = [];

  for (const effect of effects) {
    if (!effect || typeof effect !== "object") continue;
    // Skip names owned by classEdge assignment / cleanup.
    if (String(effect.name ?? "").trim() === "Full Warrior") continue;

    // Actor.migrateData runs before ready and can synthesize the legacy Tweaks
    // effect in memory. That temporary source row has an ID, but no matching
    // database row; attempting to update it produces "undefined id" on v14.
    // Persist it as a fresh effect instead. Once stored, createdTime lets a
    // retry distinguish the real row from the pre-ready temporary one.
    const generatedMigration =
      effect.flags?.[NS]?.migrationGenerated === LEGACY_TWEAK_EFFECT_MIGRATION;
    const persistedGenerated =
      generatedMigration && effect._stats?.createdTime != null;
    if (generatedMigration && !persistedGenerated) {
      const data = foundry.utils.deepClone(effect);
      delete data._id;
      delete data._key;
      delete data._stats;
      toCreate.push(data);
      continue;
    }

    const id = effect._id;
    if (!id || !sourceById.has(id)) {
      const data = foundry.utils.deepClone(effect);
      delete data._id;
      delete data._key;
      toCreate.push(data);
      continue;
    }

    const prev = sourceById.get(id);
    const prevChanges = JSON.stringify(prev.system?.changes ?? prev.changes ?? []);
    const nextChanges = JSON.stringify(effect.system?.changes ?? effect.changes ?? []);
    if (prevChanges === nextChanges && prev.name === effect.name) continue;
    toUpdate.push({
      _id: id,
      name: effect.name,
      img: effect.img,
      system: effect.system,
    });
  }

  if (toUpdate.length) {
    await actor.updateEmbeddedDocuments("ActiveEffect", toUpdate, {
      enforceTypes: false,
      wwnMigrating: true,
    });
  }
  if (toCreate.length) {
    // Avoid duplicating an already-present migration Tweaks AE.
    const existingNames = new Set(
      (actor._source?.effects ?? [])
        .filter(
          (e) =>
            e.flags?.[NS]?.migrationGenerated !== LEGACY_TWEAK_EFFECT_MIGRATION
            || e._stats?.createdTime != null
        )
        .map((e) => String(e.name ?? "").trim())
    );
    const filtered = toCreate.filter((e) => !existingNames.has(String(e.name ?? "").trim()));
    if (filtered.length) {
      await actor.createEmbeddedDocuments("ActiveEffect", filtered, { wwnMigrating: true });
    }
  }
}

/**
 * Gather plain item data from the actor, including invalid embedded docs.
 * @param {Actor} actor
 * @param {object} raw  actor.toObject()
 * @returns {object[]}
 */
function collectEmbeddedItemSources(actor, raw) {
  const byId = new Map();
  for (const i of raw.items ?? []) {
    if (i?._id) byId.set(i._id, i);
  }
  const invalidIds = actor.items?.invalidDocumentIds;
  if (invalidIds) {
    for (const id of invalidIds) {
      const doc = actor.items.getInvalid(id, { strict: false });
      if (!doc) continue;
      const src = doc.toObject?.() ?? doc;
      if (src?._id) byId.set(src._id, src);
    }
  }
  return Array.from(byId.values());
}

/**
 * Replace embedded items when legacy types remain (no actor system rewrite needed).
 * @param {Actor} actor
 * @param {object[]} itemSources
 * @returns {Promise<boolean>} true if items were cleared/recreated
 */
async function replaceEmbeddedItemsIfNeeded(actor, itemSources) {
  const items = migrateActorItems(itemSources);
  if (!embeddedItemsNeedReplace(itemSources, items)) return false;
  await replaceEmbeddedItemsSafely(actor, items);
  return true;
}

/**
 * Clear then recreate embeds; restore the pre-clear snapshot if recreate fails.
 * @param {Actor} actor
 * @param {object[]} migratedItems
 */
export async function replaceEmbeddedItemsSafely(actor, migratedItems) {
  const label = actor.name ?? actor.id;
  const backup = foundry.utils.deepClone(collectEmbeddedItemSources(actor, actor.toObject()));
  console.info(`WWN | ${label}: clearing ${actor.items?.size ?? 0} embedded items…`);
  await clearEmbeddedItems(actor);
  try {
    console.info(`WWN | ${label}: recreating ${migratedItems.length} embedded items…`);
    await recreateEmbeddedItems(actor, migratedItems);
    console.info(`WWN | ${label}: embedded items done.`);
  } catch (err) {
    console.error(
      `WWN | ${label}: recreate failed; restoring ${backup.length} embedded items…`,
      err
    );
    try {
      // A failed batch can still leave some rows behind. Ensure the restore is
      // applied to an actually empty collection rather than colliding by ID.
      await clearEmbeddedItems(actor);
      await recreateEmbeddedItems(actor, backup);
    } catch (restoreErr) {
      console.error(`WWN | ${label}: embed restore also failed:`, restoreErr);
    }
    throw err;
  }
}

/**
 * Wipe a real Actor's Item collection through Foundry's database API. A parent
 * update of the EmbeddedCollection field does not delete its server-side rows.
 * Synthetic Token actors must instead persist their base-relative ActorDelta.
 * @param {Actor} actor
 */
export async function clearEmbeddedItems(actor) {
  if (actor?.isToken) {
    throw new Error("Cannot bulk-replace Items on a synthetic Token actor; update Token.delta instead.");
  }
  // Always ask the server to clear the persisted collection. In particular,
  // do not trust a client collection after a failed create batch: the server
  // may contain rows which never reached this client's in-memory Actor.
  await actor.deleteEmbeddedDocuments("Item", [], {
    deleteAll: true,
    wwnMigrating: true,
  });
}

/**
 * @param {Actor} actor
 * @param {object[]} items
 */
async function recreateEmbeddedItems(actor, items) {
  if (!items?.length) return;
  await actor.createEmbeddedDocuments("Item", items, {
    keepId: true,
    enforceTypes: false,
    wwnMigrating: true,
  });
}

/** Ensure all embedded weapons appear on an NPC favorites list. */
async function ensureNpcWeaponFavorites(actor) {
  if (!isNpc(actor)) return;
  const favorites = mergeWeaponFavorites(actor.system.favorites, actor.items);
  if (favorites) await actor.update({ "system.favorites": favorites });
}
