/**
 * Foundry `getProperty` / `@term` replacement is case-sensitive.
 * Skill roll-data keys are lowercase (`stab`); wrap so `@Stab` and `@sTaB` hit the same value.
 * @param {object} data
 * @returns {object}
 */
export function caseInsensitiveRollData(data) {
  if (!data || typeof data !== "object") return data;
  return new Proxy(data, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      if (prop in target) return target[prop];
      const lower = prop.toLowerCase();
      if (lower !== prop && lower in target) return target[lower];
      return undefined;
    },
    has(target, prop) {
      if (typeof prop !== "string") return prop in target;
      return prop in target || prop.toLowerCase() in target;
    },
  });
}
