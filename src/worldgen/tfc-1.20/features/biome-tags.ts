/**
 * Biome-tag membership for vein `biomes` restrictions
 * (`net.dries007.tfc.world.feature.vein.VeinConfig#biomes`, `Optional<TagKey<Biome>>`).
 *
 * `IVeinConfig#canSpawnAt` (TFC 1.20.x):
 *   config().biomes().map(tag -> biomeQuery.apply(pos).is(tag)).orElse(true)
 *
 * i.e. a vein with no `biomes` field always passes; one with a tag reference (e.g.
 * `#tfc:kaolin_clay_spawns_in`) only spawns when the biome at its position is a member of that
 * tag. The member lists here are extracted directly from the real datapack tag files
 * (`data/tfc/tags/worldgen/biome/*.json`) by `tools/extract-datapack.mjs`'s `extractBiomeTags` --
 * plain data, no RNG, nothing a JVM capture would add over reading the JSON directly.
 */
import tfcBiomeTags from '@data/tfc-1.20/biome-tags.json';
import tfgBiomeTags from '@data/tfg/biome-tags.json';

/**
 * Both profiles' tables, merged: tag ids carry their namespace (`tfc:is_volcanic`,
 * `tfg:earth/is_mountain`), so one map serves both and a profile can only ever match its own tags.
 *
 * TerraFirmaGreg's tags come from its Core jar rather than the modpack repository
 * (`tools/extract-tfg-biome-tags.mjs`). Until they were extracted, all 15 TFG veins with a `biomes`
 * restriction were dropped everywhere — a tag with no members matches nothing.
 */
const MEMBER_SETS = new Map<string, ReadonlySet<string>>();
for (const table of [tfcBiomeTags.tags, tfgBiomeTags.tags] as Readonly<
  Record<string, readonly string[]>
>[]) {
  for (const [tag, members] of Object.entries(table)) {
    MEMBER_SETS.set(tag, new Set(members));
  }
}

/** Members of a biome tag id (e.g. 'tfc:kaolin_clay_spawns_in'), or `undefined` if the tag was
 * not extracted -- treated the same as "no members" by callers, never as "matches everything". */
export function biomeTagMembers(tagId: string): ReadonlySet<string> | undefined {
  return MEMBER_SETS.get(tagId);
}

/** Strips a vein JSON `biomes` field's leading '#' tag-reference marker (Minecraft datapack
 * convention) to get the plain tag id `biomeTagMembers` indexes by. Veins in this project's
 * extracted data always reference a tag (never a bare biome id) here -- `VeinConfig.CODEC` types
 * `biomes` as `Optional<TagKey<Biome>>`, not a biome id, so there is nothing else it could be. */
export function stripTagMarker(biomes: string): string {
  return biomes.startsWith('#') ? biomes.slice(1) : biomes;
}
