/**
 * Capture TFG's unmodified INIT and ADD_CONTINENTS task bodies on synthetic inputs.
 * Usage: node tools/parity/capture-tfg-initialization.mjs <TFG checkout> <TFC checkout>
 * Requires JDK 17+. This isolates task semantics; it is not a generated-world fixture.
 * Source files and compiled classes stay in an ignored temporary directory.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const [tfgArg, tfcArg] = process.argv.slice(2);
assert(tfgArg && tfcArg, 'Usage: capture-tfg-initialization.mjs <TFG checkout> <TFC checkout>');
const tfg = resolve(tfgArg);
const tfc = resolve(tfcArg);
const revision = (root) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(revision(tfg), '2cf74e65114417b7466fe80910993d0483e0a65f');
assert.equal(revision(tfc), 'b158c9c968cad7afb99cea2c937b301ff275e2e6');
mkdirSync('tools/.cache', { recursive: true });
const work = mkdtempSync(resolve('tools/.cache/tfg-init-'));
const hashes = {};
const files = [];
function source(root, name) {
  const text = readFileSync(join(root, 'src/main/java', name), 'utf8');
  hashes[name] = createHash('sha256').update(text).digest('hex');
  return text;
}
function put(name, text) {
  const file = join(work, name);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, text);
  files.push(file);
}
const base = 'net/dries007/tfc/world/';
const core = 'su/terrafirmagreg/core/world/new_ow_wg/region/';
for (const name of ['TFGInitTask', 'TFGAddContinents', 'IRegionPoint']) {
  put(core + name + '.java', source(tfg, core + name + '.java'));
}
// Apply the two actual mixin effects explicitly, without a Minecraft/Forge bootstrap:
// Point inherits PointMixin's exact methods; atInit invokes the RegionMixin init callback.
const mixinPath = 'su/terrafirmagreg/core/mixins/common/tfc/new_ow_wg/PointMixin.java';
put(mixinPath, source(tfg, mixinPath)
  .replace(/^import org\.spongepowered[^\n]*\n/gm, '')
  .replace(/^\s*@(?:Unique|Mixin)[^\n]*\n/gm, ''));
let regionSource = source(tfc, base + 'region/Region.java');
assert(regionSource.includes('public static class Point') && regionSource.includes('data[index] = point;'));
regionSource = regionSource
  .replace('public static class Point', 'public static class Point extends su.terrafirmagreg.core.mixins.common.tfc.new_ow_wg.PointMixin')
  .replace('data[index] = point;', 'data[index] = point; point.tfg$init(gridX, gridZ, index);');
put(base + 'region/Region.java', regionSource);
put(base + 'region/Units.java', source(tfc, base + 'region/Units.java'));
put(base + 'noise/FastNoiseLite.java', source(tfc, base + 'noise/FastNoiseLite.java'));
put(base + 'region/RegionTask.java', `package net.dries007.tfc.world.region; public interface RegionTask { void apply(RegionGenerator.Context context); }`);
put(base + 'region/RiverEdge.java', `package net.dries007.tfc.world.region; public class RiverEdge {}`);
put(base + 'region/AnnotateBiomeAltitude.java', `package net.dries007.tfc.world.region; public class AnnotateBiomeAltitude { public static final int WIDTH=4; }`);
put(base + 'layer/TFCLayers.java', `package net.dries007.tfc.world.layer; public class TFCLayers { public static final int OCEAN=0; }`);
put('org/jetbrains/annotations/Nullable.java', `package org.jetbrains.annotations; import java.lang.annotation.*; @Target({ElementType.TYPE_USE,ElementType.METHOD}) public @interface Nullable {}`);
put(base + 'noise/Cellular2D.java', `package net.dries007.tfc.world.noise; public class Cellular2D { public record Cell(double x,double y,int cx,int cy,double f1,double f2,double noise) {} }`);
put(base + 'noise/Noise2D.java', `package net.dries007.tfc.world.noise; public interface Noise2D { double noise(double x,double y); }`);
put(base + 'region/RegionGenerator.java', `package net.dries007.tfc.world.region;
import java.util.function.BiFunction; import net.dries007.tfc.world.noise.*;
public class RegionGenerator {
 public Noise2D continentNoise; public BiFunction<Integer,Integer,Cellular2D.Cell> sampler;
 public Cellular2D.Cell sampleCell(int x,int z){return sampler.apply(x,z);}
 public static class Context {
 public final Region region; public final Cellular2D.Cell regionCell; private final RegionGenerator generator;
 public Context(Region r,Cellular2D.Cell c,RegionGenerator g){region=r;regionCell=c;generator=g;}
 public RegionGenerator generator(){return generator;}
 }
}`);
// Only linkage helper replaced: same non-null array iteration order as RegionHelpers.points.
// The task algorithms above, FastNoiseLite rounding and Region storage remain original Java.
source(tfg, core + 'RegionHelpers.java');
put(core + 'RegionHelpers.java', `package su.terrafirmagreg.core.world.new_ow_wg.region;
import net.dries007.tfc.world.region.Region; import java.util.*;
public class RegionHelpers {
 public static int size(Region r){return r.sizeX()*r.sizeZ();}
 public static Iterable<Region.Point> points(Region r){return Arrays.stream(r.data()).filter(Objects::nonNull).toList();}
}`);
put(base + 'region/Capture.java', String.raw`package net.dries007.tfc.world.region;
import java.util.*; import net.dries007.tfc.world.noise.*;
import su.terrafirmagreg.core.world.new_ow_wg.region.*;
public class Capture {
 public static void main(String[] args){Locale.setDefault(Locale.ROOT); StringJoiner cases=new StringJoiner(",");
  for(int kind=0;kind<3;kind++){
   final int shape=kind; final double cx=kind==0?0.25:kind==1?-6.5:-127.5, cz=kind==0?-0.75:kind==1?-8.25:256.5;
   final int originX=FastNoiseLite.FastRound(cx), originZ=FastNoiseLite.FastRound(cz);
   Cellular2D.Cell cell=new Cellular2D.Cell(cx,cz,0,0,0,0,0); Region region=new Region(cell);
   RegionGenerator g=new RegionGenerator(); StringJoiner owned=new StringJoiner(",");
   g.sampler=(x,z)->{int dx=x-originX,dz=z-originZ;
    boolean own=shape==2 ? Math.abs(dx)==100 && Math.abs(dz)==100 : dx>=-3 && dx<=4 && dz>=-2 && dz<=3 && Math.floorMod(dx+dz,3)!=0;
    if(own){owned.add("["+x+","+z+"]");return new Cellular2D.Cell(cx,cz,99,99,0,0,0);}
    return new Cellular2D.Cell(cx+1,cz,0,0,0,0,0);
   };
   g.continentNoise=(x,z)->switch(Math.floorMod((int)x+2*(int)z,3)){case 0->4.4;case 1->Math.nextUp(4.4);default->Math.nextDown(4.4);};
   RegionGenerator.Context ctx=new RegionGenerator.Context(region,cell,g); TFGInitTask.INSTANCE.apply(ctx);
   StringJoiner before=new StringJoiner(",");for(Region.Point p:region.data())if(p!=null){IRegionPoint t=(IRegionPoint)p;
    before.add(String.format("[%d,%d,%d,%s,%d,%d,%s]",t.tfg$getX(),t.tfg$getZ(),t.tfg$getIndex(),p.land(),t.tfg$getDistanceToWestCoast(),t.tfg$getHotSpotAge(),t.tfg$getIsSurfaceRockKarst()));}
   TFGAddContinents.INSTANCE.apply(ctx);StringJoiner points=new StringJoiner(",");for(Region.Point p:region.data())if(p!=null){IRegionPoint t=(IRegionPoint)p;
    points.add(String.format("[%d,%d,%d,%.17g,%s]",t.tfg$getX(),t.tfg$getZ(),t.tfg$getIndex(),g.continentNoise.noise(t.tfg$getX(),t.tfg$getZ()),p.land()));}
   cases.add(String.format("{\"name\":\"shape-%d\",\"center\":[%s,%s],\"owned\":[%s],\"bounds\":[%d,%d,%d,%d],\"initialized\":[%s],\"points\":[%s]}",kind,cx,cz,owned,region.minX(),region.minZ(),region.maxX(),region.maxZ(),before,points));
  }System.out.print("["+cases+"]");
 }
}`);
execFileSync('javac', ['-encoding', 'UTF-8', '-d', work, ...files], { stdio: 'inherit' });
const cases = JSON.parse(execFileSync('java', ['-ea', '-cp', work, 'net.dries007.tfc.world.region.Capture'], { encoding: 'utf8' }));
assert.equal(cases.length, 3);
const fixture = {
  source: 'Unmodified TFGInitTask and TFGAddContinents Java; TFC Region with explicit PointMixin/atInit injection. Synthetic ownership and continent-noise inputs, not generated-world observations.',
  tfgRevision: revision(tfg), tfcRevision: revision(tfc), sourceHashes: hashes,
  shims: ['RegionGenerator.Context and supplied noise inputs', 'Cellular2D.Cell record', 'RegionHelpers non-null array iteration', 'unused river/biome linkage and Nullable annotation'],
  cases,
};
writeFileSync('tests/fixtures/tfg-0.9.21-initialization.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`Captured ${cases.length} cases / ${cases.reduce((n,c)=>n+c.points.length,0)} points from original Java tasks.`);
