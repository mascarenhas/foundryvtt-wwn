/**
 * Developed Attribute is six foci (one per ability), each with a single AE.
 */

export const DEVELOPED_ATTRIBUTE_VARIANTS = [
  { key: "str", label: "Strength" },
  { key: "dex", label: "Dexterity" },
  { key: "con", label: "Constitution" },
  { key: "int", label: "Intelligence" },
  { key: "wis", label: "Wisdom" },
  { key: "cha", label: "Charisma" },
];

const LABEL_BY_LOWER = Object.fromEntries(
  DEVELOPED_ATTRIBUTE_VARIANTS.map((v) => [v.label.toLowerCase(), v]),
);

/**
 * @param {string} name
 * @returns {{ key: string, label: string }|null}
 */
export function developedAttributeVariantFromName(name) {
  const raw = String(name ?? "").trim();
  const match = raw.match(/^developed attribute \((strength|dexterity|constitution|intelligence|wisdom|charisma)\)$/i);
  if (!match) return null;
  return LABEL_BY_LOWER[match[1].toLowerCase()] ?? null;
}

/**
 * Infer the chosen attribute from a combined Developed Attribute's effects.
 * Prefers an enabled AE; otherwise the first variant in STR→CHA order.
 * @param {object[]} effects
 * @returns {{ key: string, label: string }|null}
 */
export function developedAttributeVariantFromEffects(effects) {
  const list = Array.isArray(effects) ? effects : [];
  const candidates = [];
  for (const effect of list) {
    for (const change of effect?.system?.changes ?? effect?.changes ?? []) {
      const key = String(change?.key ?? "");
      const found = DEVELOPED_ATTRIBUTE_VARIANTS.find((v) => key === `system.abilities.${v.key}.baseMod`);
      if (found) candidates.push({ variant: found, disabled: effect.disabled === true });
    }
  }
  const enabled = candidates.find((c) => !c.disabled);
  if (enabled) return enabled.variant;
  for (const variant of DEVELOPED_ATTRIBUTE_VARIANTS) {
    const found = candidates.find((c) => c.variant.key === variant.key);
    if (found) return found.variant;
  }
  return null;
}

/**
 * @param {{ key: string, label: string }} variant
 * @returns {string}
 */
export function developedAttributeFocusName(variant) {
  return `Developed Attribute (${variant.label})`;
}
