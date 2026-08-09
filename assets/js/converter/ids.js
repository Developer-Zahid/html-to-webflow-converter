/**
 * Id generation for clipboard payloads.
 */

/** Fresh random id, for nodes that have no stable identity across conversions. */
export const newId = () => crypto.randomUUID();

/**
 * Deterministic UUID-shaped id derived from a seed string.
 *
 * Webflow matches incoming style blocks by `_id`, not by name. A fresh random id on every
 * conversion means re-pasting the same HTML produces "hero-section 2", "hero-section 3", ...
 * instead of reusing what the previous paste created. Deriving the id from the class name keeps
 * repeat pastes idempotent.
 *
 * This is a hash, not a CSPRNG - that is the point. Do not "fix" it to use crypto.
 */
export const idFromSeed = (seed) => {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	const next = () => {
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return (h >>> 0).toString(16).padStart(8, "0");
	};
	const s = next() + next() + next() + next();
	return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
};
