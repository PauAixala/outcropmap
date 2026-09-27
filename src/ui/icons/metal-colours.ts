/**
 * Which metal an anvil recipe works, and the theme token its marker is filled with.
 *
 * 565 recipes in one list all drawn in the same colour is a list you read linearly. The metal is the
 * first thing a player narrows by — "show me the black steel" — and it is already in the recipe's
 * input id, so nothing needs extracting: `forge:ingots/black_steel`, `tfc:metal/sheet/wrought_iron`
 * and `gtceu:black_bronze_rod` all name it.
 *
 * **Longest match wins, and that is load-bearing.** `steel` is a substring of `black_steel`,
 * `stainless_steel` and `high_carbon_blue_steel`; matching the first name that appears would paint a
 * third of the catalogue the same grey. Same for `bronze` inside `black_bronze`, `gold` inside
 * `rose_gold`, `silver` inside `sterling_silver`, and `bismuth` inside `bismuth_bronze`.
 *
 * Colours are token names, never hex (ADR 0005); the tokens live in `src/ui/styles/base.css` and are
 * the metals' own colours, so the legend is one a player already knows from the game.
 */

/** Metal id -> theme token, longest ids first so the scan below can stop at its first hit. */
const METAL_TOKENS: Readonly<Record<string, string>> = {
  high_carbon_black_steel: 'metal-black-steel',
  high_carbon_blue_steel: 'metal-blue-steel',
  high_carbon_red_steel: 'metal-red-steel',
  high_carbon_steel: 'metal-steel',
  stainless_steel: 'metal-stainless',
  sterling_silver: 'metal-silver',
  bismuth_bronze: 'metal-bismuth-bronze',
  black_bronze: 'metal-black-bronze',
  wrought_iron: 'metal-wrought-iron',
  black_steel: 'metal-black-steel',
  blue_steel: 'metal-blue-steel',
  red_steel: 'metal-red-steel',
  cast_iron: 'metal-cast-iron',
  rose_gold: 'metal-rose-gold',
  tin_alloy: 'metal-tin-alloy',
  pig_iron: 'metal-cast-iron',
  chromium: 'metal-stainless',
  bismuth: 'metal-bismuth',
  bronze: 'metal-bronze',
  copper: 'metal-copper',
  nickel: 'metal-nickel',
  silver: 'metal-silver',
  brass: 'metal-brass',
  steel: 'metal-steel',
  gold: 'metal-gold',
  iron: 'metal-wrought-iron',
  lead: 'metal-lead',
  zinc: 'metal-zinc',
  tin: 'metal-tin',
};

/** Longest first, computed once: object key order is insertion order, but this does not rely on it. */
const METAL_IDS = Object.keys(METAL_TOKENS).sort((a, b) => b.length - a.length);

/** The metal an item id names, or `null` when it names none (a stone, a wooden handle, a gem). */
export function metalOf(itemId: string): string | null {
  const bare = itemId.toLowerCase();
  for (const metal of METAL_IDS) {
    if (bare.includes(metal)) return metal;
  }
  return null;
}

/**
 * The CSS colour a recipe's marker is drawn in — the metal's token, or the page's own ink where the
 * recipe works no metal. `currentColor` is what the glyph's face already fills with, so setting
 * `color` on the socket is the whole of it.
 */
export function metalColour(itemId: string): string {
  const metal = metalOf(itemId);
  return metal === null ? 'var(--forge-steel)' : `var(--${METAL_TOKENS[metal]})`;
}
