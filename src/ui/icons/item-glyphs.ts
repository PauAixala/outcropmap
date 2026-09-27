/**
 * Category glyphs for anvil recipe results (docs/PLAN.md 10c P3).
 *
 * **These are our own drawings, not the mod's textures.** Extracting item sprites would put mod
 * assets in the repository, which AGENTS.md section 8 forbids — so instead of one icon per item
 * there is one icon per *kind* of item, drawn here on the same 16x16 integer grid as the waypoint
 * glyphs (docs/DESIGN.md section 6).
 *
 * The mapping keys off the structured part of TFC's own item id: `metal/<part>/<material>`. Every
 * recipe in both catalogues resolves through `<part>`, which is a real category name
 * (`pickaxe_head`, `sword_blade`, `double_sheet`), not a substring guess. Anything unrecognised
 * gets the generic glyph rather than a wrong one.
 *
 * **The vocabulary is wider than the anvil catalogues.** The second half of the table names kinds
 * beyond metal parts — blocks, ores, dusts, fluids, machines, spacecraft, stairs and roofs — so an
 * item from anywhere in a modpack gets a specific glyph rather than the generic one. Measured over
 * the 17 844 items that have a recipe in TerraFirmaGreg, the `metal/<part>/<material>` rule alone
 * recognised 14%; with the whole table 25.4% is left unrecognised, and what is left is flat (no
 * bucket over 65), which is where adding rules stops paying. Re-measure before adding more.
 */
import type { Glyph } from './glyphs';

export type ItemGlyphId =
  // Kinds beyond metal parts. The `metal/<part>/<material>` rule covers 14% of the 17 844 items
  // that have a recipe in TerraFirmaGreg: the rest are blocks, ores, dusts, fluids, machines and
  // spacecraft, and without these every one of them would land on `generic`.
  | 'dust'
  | 'fluid'
  | 'ore'
  | 'block'
  | 'machine'
  | 'wire'
  | 'gem'
  | 'mold'
  | 'plank'
  | 'stairs'
  | 'slab'
  | 'wall'
  | 'pane'
  | 'roof'
  | 'furniture'
  | 'sign'
  | 'ladder'
  | 'vessel'
  | 'rocket'
  | 'engine'
  | 'tank'
  | 'fin'
  | 'fan'
  // Added when the catalogue learned to read the pack's other mods: water flasks, Firmalife
  // plumbing, Firmaciv's cannon. Same rule as the rest -- one drawing per kind of thing.
  | 'nugget'
  | 'ring'
  | 'screw'
  | 'spring'
  | 'flask'
  | 'cannon'
  | 'cannonball'
  | 'bolt'
  | 'sprinkler'
  | 'lid'
  | 'ingot'
  | 'sheet'
  | 'rod'
  | 'head'
  | 'blade'
  | 'axe'
  | 'pickaxe'
  | 'shovel'
  | 'hoe'
  | 'hammer'
  | 'chisel'
  | 'mace'
  | 'propick'
  | 'javelin'
  | 'knife'
  | 'sword'
  | 'saw'
  | 'scythe'
  | 'armour'
  | 'helmet'
  | 'greaves'
  | 'boots'
  | 'shield'
  | 'hook'
  | 'bars'
  | 'bucket'
  | 'gear'
  | 'lamp'
  | 'tuyere'
  | 'pipe'
  | 'trapdoor'
  | 'chain'
  | 'anvil'
  | 'door'
  | 'grill'
  | 'mining_hammer'
  | 'spade'
  | 'screwdriver'
  | 'wrench'
  | 'wire_cutter'
  | 'cleaver'
  | 'file'
  | 'scraping_knife'
  | 'spindle'
  | 'organ_boot'
  | 'buckle'
  | 'pie_pan'
  | 'paper'
  | 'support'
  | 'tree_tap'
  | 'anchor'
  | 'cleat'
  | 'oarlock'
  // Added when the catalogue was rebuilt from the game's own recipes (2026-09-25) and gained the 22
  // it had been missing for want of rules: Hot or Not's tong parts and Saddles 'n' Shoes' horseshoes.
  | 'tongs'
  | 'horseshoe'
  | 'generic';

export const ITEM_GLYPHS: Readonly<Record<ItemGlyphId, Glyph>> = {
  // A mound with grains falling into it: GregTech's 1 646 dusts, and the dyes, which are powders too.
  dust: [
    [2, 13, 14, 13, 12, 10, 4, 10],
    [5, 6, 7, 6, 7, 8, 5, 8],
    [8, 3, 10, 3, 10, 5, 8, 5],
    [11, 7, 13, 7, 13, 9, 11, 9],
  ],
  // A droplet. A `fluid:` id is molten metal, and the metal colours the face.
  fluid: [[8, 1, 12, 7, 13, 10, 12, 13, 8, 15, 4, 13, 3, 10, 4, 7]],
  // A rock with the ore showing through it: the two inner subpaths are holes under the even-odd
  // rule, which is what makes them read as specks rather than as blobs painted on top.
  ore: [
    [2, 6, 5, 3, 11, 3, 14, 6, 13, 12, 9, 14, 5, 14, 3, 12],
    [5, 6, 7, 6, 7, 8, 5, 8],
    [9, 9, 12, 9, 12, 12, 9, 12],
  ],
  // A cube drawn as three faces. This is the shape the whole game is made of, so it earns being the
  // one every unrecognised *block* falls back to rather than the crate.
  block: [
    [2, 5, 8, 2, 14, 5, 8, 8],
    [2, 5, 8, 8, 8, 15, 2, 12],
    [14, 5, 14, 12, 8, 15, 8, 8],
  ],
  // A casing with a screen and a vent: any machine, whatever tier. The frame colour carries the tier.
  machine: [
    [2, 3, 14, 3, 14, 14, 2, 14],
    [4, 5, 12, 5, 12, 9, 4, 9],
    [5, 11, 11, 11, 11, 12, 5, 12],
  ],
  // A spool: two flanges and the wound core between them. Cables wind on the same thing.
  wire: [
    [3, 2, 5, 2, 5, 14, 3, 14],
    [11, 2, 13, 2, 13, 14, 11, 14],
    [5, 6, 11, 6, 11, 10, 5, 10],
  ],
  // A brilliant cut: the crown, with the table cut out so the facets read.
  gem: [
    [5, 2, 11, 2, 14, 6, 8, 15, 2, 6],
    [6, 4, 10, 4, 11, 6, 5, 6],
  ],
  // A tray with its cavity: the ceramic moulds every metal route runs through.
  mold: [
    [1, 5, 15, 5, 13, 13, 3, 13],
    [4, 7, 12, 7, 11, 11, 5, 11],
  ],
  // Two boards with the seam between them -- `sheet`'s offset plates read as metal, not as wood.
  plank: [
    [1, 3, 15, 3, 15, 7, 1, 7],
    [1, 9, 15, 9, 15, 13, 1, 13],
  ],
  stairs: [[2, 14, 2, 10, 6, 10, 6, 7, 10, 7, 10, 4, 14, 4, 14, 14]],
  // The cube again at half height, so a slab reads as a slab of the block beside it.
  slab: [
    [2, 7, 8, 4, 14, 7, 8, 10],
    [2, 7, 8, 10, 8, 14, 2, 11],
    [14, 7, 14, 11, 8, 14, 8, 10],
  ],
  // Two courses with a post rising through them.
  wall: [
    [1, 7, 15, 7, 15, 10, 1, 10],
    [1, 11, 15, 11, 15, 14, 1, 14],
    [6, 3, 10, 3, 10, 7, 6, 7],
  ],
  // A frame with four lights cut out of it: glass, panes, panels.
  pane: [
    [2, 2, 14, 2, 14, 14, 2, 14],
    [4, 4, 7, 4, 7, 7, 4, 7],
    [9, 4, 12, 4, 12, 7, 9, 7],
    [4, 9, 7, 9, 7, 12, 4, 12],
    [9, 9, 12, 9, 12, 12, 9, 12],
  ],
  // A pitch with its eaves.
  roof: [[8, 2, 15, 9, 15, 12, 8, 5, 1, 12, 1, 9]],
  // A table seen side-on: the top and two legs. Stands in for every chair, desk and drawer too.
  furniture: [
    [1, 5, 15, 5, 15, 7, 1, 7],
    [3, 7, 5, 7, 5, 14, 3, 14],
    [11, 7, 13, 7, 13, 14, 11, 14],
  ],
  // A board on a post.
  sign: [
    [2, 2, 14, 2, 14, 9, 2, 9],
    [7, 9, 9, 9, 9, 15, 7, 15],
  ],
  ladder: [
    [2, 1, 4, 1, 4, 15, 2, 15],
    [12, 1, 14, 1, 14, 15, 12, 15],
    [4, 3, 12, 3, 12, 5, 4, 5],
    [4, 7, 12, 7, 12, 9, 4, 9],
    [4, 11, 12, 11, 12, 13, 4, 13],
  ],
  // A pot: the rim and the belly under it.
  vessel: [
    [3, 3, 13, 3, 13, 5, 3, 5],
    [4, 5, 12, 5, 14, 9, 12, 14, 4, 14, 2, 9],
  ],
  // Nose, body, fins. A rocket should not be a grey crate.
  rocket: [
    [8, 1, 11, 5, 11, 12, 5, 12, 5, 5],
    [5, 9, 2, 14, 5, 14],
    [11, 9, 14, 14, 11, 14],
  ],
  // A bell nozzle.
  engine: [[5, 2, 11, 2, 11, 6, 14, 14, 2, 14, 5, 6]],
  // A banded cylinder; the bands are holes, which is what keeps it from reading as a plain box.
  tank: [
    [3, 2, 13, 2, 13, 14, 3, 14],
    [4, 5, 12, 5, 12, 6, 4, 6],
    [4, 10, 12, 10, 12, 11, 4, 11],
  ],
  fin: [[6, 1, 9, 1, 9, 10, 14, 15, 6, 15]],
  // Four blades pinwheeling from the hub.
  fan: [
    [8, 8, 8, 1, 12, 3, 11, 7],
    [8, 8, 15, 8, 13, 12, 9, 11],
    [8, 8, 8, 15, 4, 13, 5, 9],
    [8, 8, 1, 8, 3, 4, 7, 5],
  ],
  // A small lump, off-centre so it does not read as a coin.
  nugget: [[6, 7, 10, 7, 11, 9, 10, 11, 6, 11, 5, 9]],
  // Four bars around a hole: the glyphs are filled, so an inner polygon would fill it in.
  ring: [
    [4, 3, 12, 3, 12, 5, 4, 5],
    [4, 11, 12, 11, 12, 13, 4, 13],
    [3, 4, 5, 4, 5, 12, 3, 12],
    [11, 4, 13, 4, 13, 12, 11, 12],
  ],
  // A head over a tapered shank -- the taper is what tells it from a bolt.
  screw: [
    [4, 2, 12, 2, 12, 5, 4, 5],
    [6, 5, 10, 5, 8, 14],
  ],
  // Three turns of a coil seen from the side.
  spring: [
    [3, 4, 12, 3, 13, 5, 4, 6],
    [3, 8, 12, 7, 13, 9, 4, 10],
    [3, 12, 12, 11, 13, 13, 4, 14],
  ],
  // A round-bodied bottle with a short neck -- the water flasks a smith punches out of a sheet.
  flask: [
    [7, 2, 9, 2, 9, 6, 7, 6],
    [5, 6, 11, 6, 13, 9, 13, 12, 11, 14, 5, 14, 3, 12, 3, 9],
  ],
  // A tapered tube with a muzzle ring at the wide end.
  cannon: [
    [2, 6, 12, 5, 12, 11, 2, 10],
    [12, 4, 14, 4, 14, 12, 12, 12],
  ],
  cannonball: [[5, 3, 11, 3, 13, 5, 13, 11, 11, 13, 5, 13, 3, 11, 3, 5]],
  // A flat head over a shank.
  bolt: [
    [4, 2, 12, 2, 12, 5, 4, 5],
    [6, 5, 10, 5, 10, 14, 6, 14],
  ],
  // A riser, its arm, and one falling drop.
  sprinkler: [
    [6, 2, 10, 2, 10, 8, 6, 8],
    [2, 8, 14, 8, 14, 10, 2, 10],
    [7, 12, 9, 12, 9, 14, 7, 14],
  ],
  // A shallow dome on a rim, with a knob.
  lid: [
    [7, 2, 9, 2, 9, 5, 7, 5],
    [4, 5, 12, 5, 13, 10, 3, 10],
    [2, 10, 14, 10, 14, 13, 2, 13],
  ],
  // A billet with its top face, the way an ingot reads in an inventory slot.
  ingot: [
    [4, 6, 5, 4, 11, 4, 12, 6],
    [2, 12, 4, 6, 12, 6, 14, 12],
  ],
  // Two offset plates.
  sheet: [
    [1, 4, 11, 4, 11, 7, 1, 7],
    [5, 9, 15, 9, 15, 12, 5, 12],
  ],
  rod: [[3, 12, 12, 3, 14, 5, 5, 14]],
  // A tool head: a body with a socket shoulder.
  head: [[2, 3, 9, 3, 9, 6, 14, 6, 14, 10, 9, 10, 9, 13, 2, 13]],
  blade: [[2, 13, 10, 2, 13, 4, 5, 15, 2, 15]],
  axe: [
    [2, 3, 10, 2, 13, 5, 10, 10, 3, 9, 5, 6],
    [7, 8, 9, 8, 8, 15, 6, 15],
  ],
  pickaxe: [
    [1, 6, 3, 3, 8, 2, 13, 3, 15, 6, 12, 5, 9, 4, 7, 4, 4, 5],
    [7, 5, 9, 5, 9, 15, 7, 15],
  ],
  shovel: [
    [7, 1, 9, 1, 9, 9, 7, 9],
    [5, 9, 11, 9, 13, 12, 8, 15, 3, 12],
  ],
  hoe: [
    [4, 2, 13, 2, 13, 5, 8, 5, 8, 8, 6, 8, 6, 5, 4, 5],
    [6, 7, 8, 7, 5, 15, 3, 15],
  ],
  hammer: [
    [2, 3, 13, 3, 15, 5, 13, 8, 2, 8, 1, 5],
    [7, 8, 10, 8, 10, 15, 7, 15],
  ],
  chisel: [[6, 1, 10, 1, 9, 12, 8, 15, 7, 12]],
  mace: [
    [5, 1, 11, 1, 14, 4, 14, 9, 11, 11, 6, 10, 3, 7, 3, 4],
    [7, 10, 10, 10, 6, 15, 3, 15],
  ],
  propick: [
    [1, 6, 5, 3, 11, 2, 15, 4, 10, 4, 7, 5, 4, 7],
    [7, 5, 9, 5, 9, 15, 7, 15],
  ],
  javelin: [[7, 1, 11, 5, 9, 6, 4, 15, 2, 13, 7, 5, 5, 3]],
  knife: [[3, 12, 9, 3, 13, 2, 12, 6, 6, 13, 6, 15, 2, 15]],
  sword: [
    [7, 1, 11, 1, 10, 10, 8, 12, 6, 10],
    [3, 10, 13, 10, 13, 12, 3, 12],
    [7, 12, 10, 12, 10, 15, 7, 15],
  ],
  saw: [[2, 4, 14, 2, 13, 7, 11, 6, 10, 9, 8, 7, 7, 10, 5, 8, 4, 11, 2, 9]],
  scythe: [
    [5, 3, 10, 1, 15, 2, 12, 4, 8, 5, 6, 7],
    [6, 5, 8, 6, 5, 15, 3, 15],
  ],
  // A breastplate silhouette, for the unfinished_* armour pieces.
  armour: [[4, 2, 12, 2, 12, 5, 14, 7, 14, 14, 2, 14, 2, 7, 4, 5]],
  helmet: [[3, 7, 5, 3, 11, 3, 14, 7, 14, 13, 10, 13, 10, 9, 7, 9, 7, 13, 3, 13]],
  greaves: [
    [3, 2, 7, 2, 7, 9, 5, 15, 2, 15, 4, 8],
    [9, 2, 13, 2, 12, 8, 14, 15, 11, 15, 9, 9],
  ],
  boots: [
    [2, 3, 7, 3, 7, 11, 3, 14, 1, 12],
    [9, 3, 14, 3, 15, 12, 13, 14, 9, 11],
  ],
  shield: [[8, 1, 14, 4, 13, 11, 8, 15, 3, 11, 2, 4]],
  hook: [[8, 1, 10, 1, 10, 10, 8, 14, 4, 14, 2, 11, 2, 8, 5, 8, 5, 11, 7, 11, 8, 9]],
  bars: [
    [2, 2, 4, 2, 4, 14, 2, 14],
    [7, 2, 9, 2, 9, 14, 7, 14],
    [12, 2, 14, 2, 14, 14, 12, 14],
  ],
  bucket: [
    [1, 2, 15, 2, 15, 4, 1, 4],
    [2, 4, 14, 4, 12, 14, 4, 14],
  ],
  // Eight-toothed wheel; the second subpath is the hub, cut out under the even-odd rule.
  gear: [
    [
      6, 1, 10, 1, 10, 3, 13, 3, 13, 6, 15, 6, 15, 10, 13, 10, 13, 13, 10, 13, 10, 15, 6, 15, 6, 13,
      3, 13, 3, 10, 1, 10, 1, 6, 3, 6, 3, 3, 6, 3,
    ],
    [6, 6, 10, 6, 10, 10, 6, 10],
  ],
  // A hanging lamp: bail, body, and the bright cut-out where the fuel sits.
  lamp: [
    [7, 1, 9, 1, 9, 4, 7, 4],
    [5, 4, 11, 4, 13, 9, 11, 15, 5, 15, 3, 9],
    [6, 8, 10, 8, 10, 12, 6, 12],
  ],
  // A tuyere: a tapering nozzle seen from the side, wide mouth to narrow tip.
  tuyere: [
    [1, 3, 6, 3, 6, 13, 1, 13],
    [6, 5, 12, 7, 15, 7, 15, 9, 12, 9, 6, 11],
  ],
  // A pipe: a tube with a collar at each end, which is what distinguishes it from a plain rod.
  pipe: [
    [1, 5, 4, 5, 4, 11, 1, 11],
    [4, 6, 12, 6, 12, 10, 4, 10],
    [12, 5, 15, 5, 15, 11, 12, 11],
  ],
  // A trapdoor: a panel with its plank seams and two hinges.
  trapdoor: [
    [2, 3, 14, 3, 14, 13, 2, 13],
    [4, 5, 6, 5, 6, 11, 4, 11],
    [10, 5, 12, 5, 12, 11, 10, 11],
  ],
  // Chain: interlocking links, which `bars` (straight uprights) does not suggest at all.
  chain: [
    [6, 1, 10, 1, 10, 6, 6, 6],
    [7, 3, 9, 3, 9, 4, 7, 4],
    [6, 6, 10, 6, 10, 11, 6, 11],
    [7, 8, 9, 8, 9, 9, 7, 9],
    [6, 11, 10, 11, 10, 15, 6, 15],
  ],
  // The anvil itself, for the recipes that make one.
  anvil: [
    [2, 4, 14, 4, 14, 7, 11, 7, 10, 10, 12, 10, 12, 13, 4, 13, 4, 10, 6, 10, 5, 7, 2, 7],
  ],
  // A door: the leaf, its upper window and the handle.
  door: [
    [3, 1, 13, 1, 13, 15, 3, 15],
    [5, 3, 11, 3, 11, 7, 5, 7],
    [10, 9, 12, 9, 12, 11, 10, 11],
  ],
  // A grill: a frame crossed by bars, which is what a wrought-iron grill is and `bars` is not.
  grill: [
    [2, 2, 14, 2, 14, 14, 2, 14],
    [4, 4, 6, 4, 6, 12, 4, 12],
    [7, 4, 9, 4, 9, 12, 7, 12],
    [10, 4, 12, 4, 12, 12, 10, 12],
  ],
  // GregTech's mining hammer: a heavy two-faced sledge, much bigger than the forging hammer.
  mining_hammer: [
    [1, 2, 15, 2, 15, 9, 1, 9],
    [7, 9, 9, 9, 9, 15, 7, 15],
  ],
  // A spade: a square, flat blade on a short socket, wider and blunter than the shovel.
  spade: [
    [6, 1, 10, 1, 10, 5, 6, 5],
    [3, 5, 13, 5, 13, 12, 8, 15, 3, 12],
  ],
  // A screwdriver tip: collar, thin shank, flattened point.
  screwdriver: [[6, 1, 10, 1, 10, 5, 9, 5, 9, 12, 8, 15, 7, 12, 7, 5, 6, 5]],
  // An open-ended wrench: the jaw's gap is what makes it a wrench.
  wrench: [[3, 1, 6, 1, 6, 4, 10, 4, 10, 1, 13, 1, 13, 7, 9, 9, 9, 15, 7, 15, 7, 9, 3, 7]],
  // Wire cutters: two short jaws closing on a pivot, handles spreading below it.
  wire_cutter: [[6, 1, 8, 5, 10, 1, 11, 2, 9, 7, 12, 15, 10, 15, 8, 9, 6, 15, 4, 15, 7, 7, 5, 2]],
  // A butchery knife is a cleaver: a deep square blade with a hole by the spine, and a handle.
  cleaver: [
    [1, 3, 11, 3, 11, 11, 3, 11, 1, 9],
    [11, 5, 15, 5, 15, 8, 11, 8],
    [2, 4, 4, 4, 4, 6, 2, 6],
  ],
  // A file: a long flat bar with cut teeth and a pointed tang.
  file: [
    [6, 1, 10, 1, 10, 11, 6, 11],
    [7, 11, 9, 11, 8, 15],
    [7, 3, 9, 3, 9, 4, 7, 4],
    [7, 6, 9, 6, 9, 7, 7, 7],
    [7, 9, 9, 9, 9, 10, 7, 10],
  ],
  // A scraping knife: a crescent blade under a centred grip, for working hides.
  scraping_knife: [
    [2, 6, 14, 6, 12, 10, 8, 12, 4, 10],
    [7, 2, 9, 2, 9, 6, 7, 6],
  ],
  // A spindle head seen side-on: the flattened whorl with the shaft running through it.
  spindle: [
    [1, 8, 4, 5, 12, 5, 15, 8, 12, 11, 4, 11],
    [7, 1, 9, 1, 9, 5, 7, 5],
    [7, 11, 9, 11, 9, 15, 7, 15],
  ],
  // An organ pipe boot: the cone the pipe stands on, wide at the top, narrowing to the wind hole.
  organ_boot: [[3, 1, 13, 1, 13, 3, 11, 3, 9, 14, 7, 14, 5, 3, 3, 3]],
  // A buckle: the frame, and the prong crossing the opening.
  buckle: [
    [2, 3, 14, 3, 14, 13, 2, 13],
    [4, 5, 12, 5, 12, 11, 4, 11],
    [4, 7, 10, 7, 10, 9, 4, 9],
  ],
  // A pie pan: a shallow dish with a rim, seen from the side.
  pie_pan: [
    [1, 6, 15, 6, 15, 8, 13, 12, 3, 12, 1, 8],
    [3, 8, 13, 8, 12, 10, 4, 10],
  ],
  // A sheet of paper with a folded corner.
  paper: [
    [3, 1, 10, 1, 13, 4, 13, 15, 3, 15],
    [10, 1, 10, 4, 13, 4],
  ],
  // A mine support: the beam across two posts, as the block looks placed.
  support: [
    [1, 2, 15, 2, 15, 5, 1, 5],
    [3, 5, 6, 5, 6, 15, 3, 15],
    [10, 5, 13, 5, 13, 15, 10, 15],
  ],
  // A tree tap: the spile driven into the trunk, its spout turning down, and the bucket hook.
  tree_tap: [
    [1, 5, 11, 5, 14, 8, 14, 12, 12, 12, 12, 9, 10, 8, 1, 8],
    [4, 8, 6, 8, 6, 11, 4, 11],
  ],
  anchor: [
    [7, 1, 9, 1, 9, 3, 11, 3, 11, 5, 9, 5, 9, 12, 12, 10, 14, 10, 13, 12, 9, 15, 7, 15, 3, 12, 2, 10, 4, 10, 7, 12, 7, 5, 5, 5, 5, 3, 7, 3],
  ],
  // A mooring cleat: two horns on a waisted base.
  cleat: [[1, 6, 15, 6, 15, 8, 11, 8, 11, 11, 13, 13, 3, 13, 5, 11, 5, 8, 1, 8]],
  // An oarlock: the fork the oar rests in, on its pin.
  oarlock: [[3, 1, 6, 1, 6, 7, 10, 7, 10, 1, 13, 1, 13, 9, 9, 11, 9, 15, 7, 15, 7, 11, 3, 9]],
  // One arm of a pair of tongs: the long handle, the pivot boss, and the jaw bent over at the top.
  tongs: [
    [7, 5, 9, 5, 9, 15, 7, 15],
    [6, 7, 10, 7, 10, 10, 6, 10],
    [7, 1, 13, 1, 13, 3, 9, 3, 9, 5, 7, 5],
  ],
  // A horseshoe: the thick U, open at the heel, and the nail holes along each branch.
  horseshoe: [
    [2, 2, 6, 2, 6, 9, 8, 11, 10, 9, 10, 2, 14, 2, 14, 10, 10, 15, 6, 15, 2, 10],
    [3, 4, 5, 4, 5, 5, 3, 5],
    [11, 4, 13, 4, 13, 5, 11, 5],
  ],
  generic: [[3, 4, 11, 4, 13, 6, 13, 14, 3, 14]],
};

/** Exact part names, checked before the suffix rules below. */
const EXACT_PARTS: Readonly<Record<string, ItemGlyphId>> = {
  ingot: 'ingot',
  double_ingot: 'ingot',
  sheet: 'sheet',
  double_sheet: 'sheet',
  rod: 'rod',
  double_rod: 'rod',
  bars: 'bars',
  chain: 'chain',
  bucket: 'bucket',
  trapdoor: 'trapdoor',
  shield: 'shield',
  axe_head: 'axe',
  pickaxe_head: 'pickaxe',
  shovel_head: 'shovel',
  hoe_head: 'hoe',
  hammer_head: 'hammer',
  chisel_head: 'chisel',
  mace_head: 'mace',
  propick_head: 'propick',
  javelin_head: 'javelin',
  knife_blade: 'knife',
  sword_blade: 'sword',
  saw_blade: 'saw',
  scythe_blade: 'scythe',
  unfinished_helmet: 'helmet',
  unfinished_greaves: 'greaves',
  unfinished_boots: 'boots',
  unfinished_chestplate: 'armour',
  unfinished_lamp: 'lamp',
  tuyere: 'tuyere',
  brass_mechanisms: 'gear',
  steel_pipe: 'pipe',
  blowpipe: 'pipe',
  fish_hook: 'hook',
  jar_lid: 'sheet',
  refined_iron_bloom: 'ingot',
  mining_hammer_head: 'mining_hammer',
  spade_head: 'spade',
  screwdriver_tip: 'screwdriver',
  wrench_tip: 'wrench',
  wire_cutter_head: 'wire_cutter',
  knife_butchery_head: 'cleaver',
  file_head: 'file',
  scraping_knife_blade: 'scraping_knife',
  buckle: 'buckle',
  pie_pan: 'pie_pan',
  soaked_unrefined_paper: 'paper',
  tree_tap: 'tree_tap',
  anchor: 'anchor',
  cleat: 'cleat',
  oarlock: 'oarlock',
  // `sns:metal/horseshoe/<material>` has the TFC shape; `tfchotornot:tong_part/<material>` names its
  // part first and has no third segment, which `itemGlyphFor` reads as a last resort.
  horseshoe: 'horseshoe',
  tong_part: 'tongs',
  // Machines named as one word, and the blocks a recipe chain bottoms out in.
  millstone: 'machine',
  crucible: 'vessel',
  bloomery: 'machine',
  barrel: 'vessel',
  quern: 'machine',
  firepit: 'machine',
  forge: 'machine',
  crucible_block: 'vessel',
  planks: 'plank',
  wood: 'plank',
  log: 'plank',
  bricks: 'block',
  brick: 'block',
  cobble: 'block',
  smooth: 'block',
  polished: 'block',
  flagstones: 'block',
  shingles: 'roof',
  raw: 'ore',
  gem: 'gem',
  dust: 'dust',
  fan: 'fan',
  block: 'block',
  sign: 'sign',
  axle: 'rod',
  chest: 'block',
  lectern: 'furniture',
  lumber: 'plank',
  gutters: 'roof',
  clutch: 'machine',
  sluice: 'machine',
  support: 'support',
};

/**
 * The multi-word parts, longest first, for a `<material>_<part>` id. Single words are left to the
 * suffix rules in `itemGlyphFor`, which already order them deliberately (`_bars` before `_head`).
 */
const PART_SUFFIXES: readonly string[] = Object.keys(EXACT_PARTS)
  .filter((key) => key.includes('_'))
  .sort((a, b) => b.length - a.length);

/**
 * The glyph for one result item id, e.g. `tfc:metal/pickaxe_head/steel` -> `head`.
 * Presentation only: a glyph never identifies a recipe.
 */
export function itemGlyphFor(itemId: string): ItemGlyphId {
  // `fluid:` names a fluid. It is not a registry id, so it has to be peeled here
  // rather than by every caller: `fluid:tfc:metal/steel` is molten steel, and it is a droplet.
  if (itemId.startsWith('fluid:')) return 'fluid';
  const path = itemId.includes(':') ? itemId.slice(itemId.indexOf(':') + 1) : itemId;
  // `tfc:ore/normal_native_gold` carries its category in the *first* segment, not the middle one,
  // so the `metal/<part>/<material>` rule below never sees it.
  if (path.startsWith('ore/') || path.startsWith('raw/')) return 'ore';
  const segments = path.split('/');
  // `metal/<part>/<material>` is the shape that carries a category; anything else has only a name.
  const part = (segments.length >= 3 ? segments[1] : segments.at(-1)) ?? '';

  const exact = EXACT_PARTS[part];
  if (exact) return exact;
  // GregTech names a part `<material>_<part>` (`gtceu:steel_mining_hammer_head`), and since the
  // forge catalogue shows the game's own result ids rather than TFC-shaped display names, the part
  // is the longest known suffix.
  const suffix = PART_SUFFIXES.find((known) => part.endsWith(`_${known}`));
  if (suffix !== undefined) return EXACT_PARTS[suffix]!;
  if (part.endsWith('_ingot')) return 'ingot';
  if (part.endsWith('_bars') || part.endsWith('_bars_overlay')) return 'bars';
  if (part.endsWith('spindle_head')) return 'spindle';
  if (part.endsWith('_support')) return 'support';
  if (part.endsWith('_boot')) return 'organ_boot';
  if (part.includes('trapdoor')) return 'trapdoor';
  if (part.endsWith('_head')) return 'head';
  if (part.endsWith('_blade')) return 'blade';
  if (part.endsWith('_nugget')) return 'nugget';
  if (part.endsWith('_ring')) return 'ring';
  if (part.endsWith('_screw')) return 'screw';
  if (part.endsWith('_spring')) return 'spring';
  if (part.endsWith('_plate')) return 'sheet';
  if (part.endsWith('_gear')) return 'gear';
  if (part.endsWith('_rod')) return 'rod';
  if (part.endsWith('_flask')) return 'flask';
  if (part.endsWith('_barrel')) return 'cannon';
  if (part.endsWith('cannonball')) return 'cannonball';
  if (part.endsWith('_bolt')) return 'bolt';
  if (part.endsWith('_pipe')) return 'pipe';
  if (part.endsWith('sprinkler')) return 'sprinkler';
  if (part.endsWith('_lid')) return 'lid';
  if (part.startsWith('unfinished_')) return 'armour';
  if (part.includes('door')) return 'door';
  if (part.includes('grill')) return 'grill';
  if (part.includes('lamp')) return 'lamp';
  if (part.includes('anvil')) return 'anvil';

  // Items beyond metal parts. Order is deliberate where two suffixes overlap:
  // `_hatch` before `_trapdoor`'s shape, `_ore` before `_block` (`*_ore_block` is still an ore).
  if (part.endsWith('_dust') || part.endsWith('_dye')) return 'dust';
  if (part.endsWith('_ore') || part.startsWith('raw_')) return 'ore';
  if (part.endsWith('_gem')) return 'gem';
  if (part.endsWith('_sheet') || part.endsWith('_foil')) return 'sheet';
  if (part.endsWith('_wire') || part.endsWith('_cable')) return 'wire';
  if (part.endsWith('_mold')) return 'mold';
  if (part.endsWith('_vessel')) return 'vessel';
  if (part.endsWith('_axle')) return 'rod';
  if (part.endsWith('_wheel')) return 'gear';
  if (part.endsWith('_ball')) return 'nugget';

  // Machines. GregTech and Create name them after the work they do, and the list is closed enough
  // to match on.
  if (
    part.endsWith('_furnace') ||
    part.endsWith('_press') ||
    part.endsWith('_compressor') ||
    part.endsWith('_macerator') ||
    part.endsWith('_mixer') ||
    part.endsWith('_centrifuge') ||
    part.endsWith('_crafter') ||
    part.endsWith('_arm') ||
    part.endsWith('_casing') ||
    part.endsWith('_frame') ||
    part.endsWith('_boiler') ||
    part.endsWith('_smokebox') ||
    part.endsWith('_converter')
  ) {
    return 'machine';
  }

  // Spacecraft.
  if (part.endsWith('_rocket')) return 'rocket';
  if (part.endsWith('_cone')) return 'rocket';
  if (part.endsWith('_fin')) return 'fin';
  if (part.endsWith('_engine')) return 'engine';
  if (part.endsWith('_tank')) return 'tank';

  // Building and decoration. Thousands of items, none of them interesting on their own, all of
  // them better as their own shape than as one grey crate repeated down the page.
  if (part.endsWith('_stairs') || part.endsWith('_stair')) return 'stairs';
  if (part.endsWith('_slab')) return 'slab';
  if (part.endsWith('_wall') || part.endsWith('_pillar')) return 'wall';
  if (part.endsWith('_fences') || part.endsWith('_fence') || part.endsWith('_gate')) return 'bars';
  if (part.endsWith('_window') || part.endsWith('_pane') || part.endsWith('_panel')) return 'pane';
  if (part.endsWith('_roofs') || part.endsWith('_roof') || part.includes('shingle')) return 'roof';
  if (part.endsWith('_sign')) return 'sign';
  if (part.endsWith('_ladder')) return 'ladder';
  if (part.endsWith('_hatch')) return 'trapdoor';
  if (part.endsWith('_indicator')) return 'lamp';
  if (part.endsWith('_planks') || part.endsWith('_plank') || part.endsWith('_log')) return 'plank';
  if (
    part.endsWith('_furniture') ||
    part.endsWith('_table') ||
    part.endsWith('_chair') ||
    part.endsWith('_desk') ||
    part.endsWith('_counter') ||
    part.endsWith('_wardrobe') ||
    part.endsWith('_drawer') ||
    part.endsWith('_shelf') ||
    part.endsWith('_bookshelf')
  ) {
    return 'furniture';
  }
  if (part.endsWith('_box') || part.endsWith('_chest')) return 'block';
  if (part.endsWith('_knife')) return 'knife';
  if (part.endsWith('_hammer')) return 'hammer';
  if (part.endsWith('_cutter')) return 'wire_cutter';
  if (part.endsWith('_flywheel')) return 'gear';
  if (part.endsWith('_catalyst')) return 'dust';
  if (part.endsWith('_roofing')) return 'roof';
  if (part.endsWith('_carpet') || part.endsWith('_terracotta')) return 'block';
  // GregTech's multiblock parts: hatches, buses, chargers, vents, upgrades, and the `_4x` variants.
  if (
    part.includes('hatch') ||
    part.includes('_bus') ||
    part.endsWith('_vent') ||
    part.endsWith('_upgrade') ||
    part.includes('charger')
  ) {
    return 'machine';
  }
  // Railway track: two rails and the sleepers between them, which is the ladder's shape exactly.
  if (part.startsWith('track_')) return 'ladder';
  if (
    part.endsWith('_block') ||
    part.endsWith('_bricks') ||
    part.endsWith('_brick') ||
    part.endsWith('_cobble') ||
    part.endsWith('_locometal') ||
    part.endsWith('_road') ||
    part.endsWith('_bridges') ||
    part.endsWith('_bridge')
  ) {
    return 'block';
  }
  // `<part>/<material>`: two segments, the category first (`tfchotornot:tong_part/copper`). Only
  // after every rule above, so an id they already recognise by its last segment keeps its glyph.
  const lead = segments.length === 2 ? EXACT_PARTS[segments[0]!] : undefined;
  if (lead !== undefined) return lead;
  return 'generic';
}
