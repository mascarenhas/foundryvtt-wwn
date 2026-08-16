/**
 * Shared item-description helpers for chat cards.
 */

/**
 * Whether HTML (or plain text) has visible description content.
 * @param {string} html
 * @returns {boolean}
 */
export function hasRenderableDescription(html) {
  return String(html ?? "").replace(/<[^>]+>/g, "").trim().length > 0;
}

/**
 * Enrich an item's description for chat, or "" when there is nothing to show.
 * @param {Item} item
 * @returns {Promise<string>}
 */
export async function enrichItemDescription(item) {
  const raw = item?.system?.description ?? "";
  if (!hasRenderableDescription(raw)) return "";
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
    relativeTo: item,
    secrets: false,
  });
}
