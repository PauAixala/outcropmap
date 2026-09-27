/** Capture TFC 1.20 BiomeNoise height functions from the actual Java source. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const checkout = resolve(process.argv[2] ?? '');
const base = join(checkout, 'src/main/java/net/dries007/tfc');
const work = mkdtempSync(join(tmpdir(), 'tfc-biome-noise-parity-'));
const files = [];
function put(path, content) {
  const target = join(work, path);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
  files.push(target);
}
function source(path) {
  return readFileSync(join(base, path), 'utf8');
}
for (const name of ['FastNoiseLite', 'Noise2D', 'OpenSimplex2D', 'Cellular2D']) {
  put(`net/dries007/tfc/world/noise/${name}.java`, source(`world/noise/${name}.java`));
}
put('net/dries007/tfc/world/biome/VolcanoNoise.java', source('world/biome/VolcanoNoise.java'));
put('net/dries007/tfc/world/biome/BiomeNoise.java', source('world/biome/BiomeNoise.java'));
put(
  'net/dries007/tfc/world/BiomeNoiseSampler.java',
  'package net.dries007.tfc.world; public interface BiomeNoiseSampler {void setColumn(int x,int z);double height();double noise(int y);}',
);
put(
  'net/dries007/tfc/world/TFCChunkGenerator.java',
  'package net.dries007.tfc.world; public class TFCChunkGenerator { public static final int SEA_LEVEL_Y=63; }',
);
put(
  'it/unimi/dsi/fastutil/HashCommon.java',
  'package it.unimi.dsi.fastutil; public class HashCommon { public static int long2int(long v){return (int)(v ^ (v >>> 32));}}',
);
put(
  'net/minecraft/util/Mth.java',
  `package net.minecraft.util;
public class Mth {
 public static float map(float v,float a,float b,float lo,float hi){return lo+(v-a)*(hi-lo)/(b-a);}
 public static double map(double v,double a,double b,double lo,double hi){return lo+(v-a)*(hi-lo)/(b-a);}
 public static float clamp(float v,float lo,float hi){return Math.max(lo,Math.min(hi,v));}
 public static double clamp(double v,double lo,double hi){return Math.max(lo,Math.min(hi,v));}
 public static double lerp(double t,double a,double b){return a+t*(b-a);}
 public static double clampedMap(double v,double a,double b,double lo,double hi){return lerp(clamp((v-a)/(b-a),0,1),lo,hi);}
}`,
);
put(
  'net/minecraft/core/BlockPos.java',
  'package net.minecraft.core; public record BlockPos(int x,int y,int z) {}',
);
put(
  'org/jetbrains/annotations/Nullable.java',
  'package org.jetbrains.annotations; public @interface Nullable {}',
);
put(
  'Capture.java',
  `import java.util.*;
import net.dries007.tfc.world.biome.BiomeNoise;
import net.dries007.tfc.world.noise.Noise2D;
public class Capture {
 static void add(List<String> names,List<Noise2D> values,String name,Noise2D value){names.add(name);values.add(value);}
 public static void main(String[] args){Locale.setDefault(Locale.ROOT);StringJoiner rows=new StringJoiner(",");
  long[] seeds={0L,1L,-1L,123456789L,Long.MIN_VALUE,Long.MAX_VALUE};
  double[][] points={{0,0},{1,-1},{-1,-1},{12.5,-93.25},{-156.25,156.25},{234375,-234375},{8192.5,4096.25}};
  for(long seed:seeds){List<String> names=new ArrayList<>();List<Noise2D> noises=new ArrayList<>();
   add(names,noises,"badlands",BiomeNoise.badlands(seed));add(names,noises,"bryceCanyon",BiomeNoise.bryceCanyon(seed));
   add(names,noises,"canyonsLow",BiomeNoise.canyons(seed,-8,21));add(names,noises,"canyons",BiomeNoise.canyons(seed,-2,40));
   add(names,noises,"hillsPlains",BiomeNoise.hills(seed,4,10));add(names,noises,"hills",BiomeNoise.hills(seed,-5,16));
   add(names,noises,"hillsRolling",BiomeNoise.hills(seed,-5,28));add(names,noises,"hillsPlateau",BiomeNoise.hills(seed,20,30));
   add(names,noises,"sharpHills",BiomeNoise.sharpHills(seed));add(names,noises,"lake",BiomeNoise.lake(seed));
   add(names,noises,"lowlands",BiomeNoise.lowlands(seed));add(names,noises,"mountains",BiomeNoise.mountains(seed,10,70));
   add(names,noises,"oldMountains",BiomeNoise.mountains(seed,16,40));add(names,noises,"oceanicMountains",BiomeNoise.mountains(seed,-16,60));
   add(names,noises,"volcanicMountainsBase",BiomeNoise.mountains(seed,10,60));add(names,noises,"volcanicOceanicMountainsBase",BiomeNoise.mountains(seed,-24,50));
   add(names,noises,"ocean",BiomeNoise.ocean(seed,-26,-12));add(names,noises,"oceanReef",BiomeNoise.ocean(seed,-16,-8));
   add(names,noises,"deepOcean",BiomeNoise.ocean(seed,-30,-16));add(names,noises,"oceanRidge",BiomeNoise.oceanRidge(seed,-30,-16));
   add(names,noises,"shore",BiomeNoise.shore(seed));add(names,noises,"tidalFlats",BiomeNoise.tidalFlats(seed));
   add(names,noises,"volcanicCanyons",BiomeNoise.addVolcanoes(seed,BiomeNoise.canyons(seed,-2,40),6,14,30));
   add(names,noises,"volcanicMountains",BiomeNoise.addVolcanoes(seed,BiomeNoise.mountains(seed,10,60),4,25,50));
   add(names,noises,"volcanicOceanicMountains",BiomeNoise.addVolcanoes(seed,BiomeNoise.mountains(seed,-24,50),2,-12,50));
   for(int i=0;i<names.size();i++)for(double[] p:points){double value=noises.get(i).noise(p[0],p[1]);rows.add(String.format("{\\"name\\":\\"%s\\",\\"seed\\":\\"%d\\",\\"x\\":%s,\\"z\\":%s,\\"value\\":%s}",names.get(i),seed,p[0],p[1],value));}
  }
  for(double in:new double[]{-1,-.67,-.5,-.15,0,.15,.5,.67,1})rows.add(String.format("{\\"name\\":\\"sharpHillsMap\\",\\"seed\\":\\"0\\",\\"x\\":%s,\\"z\\":0,\\"value\\":%s}",in,BiomeNoise.sharpHillsMap(in)));
  System.out.print("["+rows+"]");
 }
}`,
);
execFileSync('javac', ['-d', work, ...files], { stdio: 'inherit' });
const cases = JSON.parse(
  execFileSync('java', ['-cp', work, 'Capture'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
);
const revision = execFileSync(
  'git',
  ['-c', `safe.directory=${checkout.replaceAll('\\', '/')}`, '-C', checkout, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
).trim();
mkdirSync('tests/fixtures/tfc-1.20', { recursive: true });
writeFileSync(
  'tests/fixtures/tfc-1.20/biome-noise.json',
  `${JSON.stringify(
    {
      source:
        'Actual TFC 1.20.x BiomeNoise, VolcanoNoise, Cellular2D, OpenSimplex2D and FastNoiseLite. Minecraft and fastutil linkage use minimal shims. Seeds are supplied directly.',
      revision,
      capturedAt: new Date().toISOString(),
      cases,
    },
    null,
    2,
  )}\n`,
);
console.log(`Captured ${cases.length} cases from ${revision}; temporary sources: ${work}`);
