/**
 * Shared apply-damage / apply-healing chat notice content.
 * Used by the chat-log context menu and by card apply buttons.
 */

/**
 * @param {number} amount        Signed base amount (negative when healing)
 * @param {number} multiplier    Card / menu multiplier
 * @param {string[]} names       Token or actor names that received the change
 * @returns {{ title: string, img: string, list: string[] }}
 */
export function buildApplyDamageNotice(amount, multiplier, names = []) {
  const applied = Math.floor(Number(amount) * Number(multiplier));
  const isHeal = applied < 0 || (applied === 0 && (Number(amount) < 0 || Number(multiplier) < 0));
  return {
    title: isHeal
      ? `Applied ${Math.abs(applied)} healing`
      : `Applied ${Math.abs(applied)} damage`,
    img: isHeal ? "icons/svg/heal.svg" : "icons/svg/blood.svg",
    list: [...names],
  };
}
