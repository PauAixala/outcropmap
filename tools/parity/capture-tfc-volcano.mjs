/**
 * Capture VolcanoNoise outputs from the actual TFC 1.20 Java source.
 * Usage: node tools/parity/capture-tfc-volcano.mjs <TFC checkout>
 * Requires JDK 17. Minecraft and fastutil types below are minimal linkage shims.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const checkout = resolve(process.argv[2] ?? '');
const base = join(checkout, 'src/main/java/net/dries007/tfc');
const work = mkdtempSync(join(tmpdir(), 'tfc-volcano-parity-'));
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
put(
  'it/unimi/dsi/fastutil/HashCommon.java',
  'package it.unimi.dsi.fastutil; public class HashCommon { public static int long2int(long v){return (int)(v ^ (v >>> 32));}}',
);
put(
  'net/minecraft/util/Mth.java',
  `package net.minecraft.util;
public class Mth {
 public static float map(float v,float a,float b,float lo,float hi){return lo+(v-a)*(hi-lo)/(b-a);}
 public static float clamp(float v,float lo,float hi){return Math.max(lo,Math.min(hi,v));}
 public static double clamp(double v,double lo,double hi){return Math.max(lo,Math.min(hi,v));}
 public static double lerp(double t,double a,double b){return a+t*(b-a);}
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
  'net/dries007/tfc/world/TFCChunkGenerator.java',
  'package net.dries007.tfc.world; public class TFCChunkGenerator { public static final int SEA_LEVEL_Y=63; }',
);
put(
  'Capture.java',
  `import java.util.*;
import net.dries007.tfc.world.biome.VolcanoNoise;
import net.minecraft.core.BlockPos;
public class Capture {
 public static void main(String[] args) {
  Locale.setDefault(Locale.ROOT);
  StringJoiner rows=new StringJoiner(",");
  long[] seeds={0L,1L,-1L,123456789L,Long.MIN_VALUE,Long.MAX_VALUE};
  double[][] points={{0,0},{1,-1},{-1,-1},{12.5,-93.25},{-156.25,156.25},{234375,-234375},{8192.5,4096.25}};
  int[] rarities={1,2,5,10,100};
  double[] bases={40,63,91.75};
  for(long seed:seeds){VolcanoNoise n=new VolcanoNoise(seed);int i=0;
   for(double[] p:points)for(int rarity:rarities){double base=bases[i++%bases.length];
    float easing=n.calculateEasing((int)p[0],(int)p[1],rarity);
    BlockPos c=n.calculateCenter((int)p[0],70,(int)p[1],rarity);
    String center=c==null?"null":String.format("[%d,%d,%d]",c.x(),c.y(),c.z());
    double modified=n.modifyHeight(p[0],p[1],base,rarity,18,96);
    rows.add(String.format("{\\"seed\\":\\"%d\\",\\"x\\":%s,\\"z\\":%s,\\"rarity\\":%d,\\"baseHeight\\":%s,\\"easing\\":%s,\\"center\\":%s,\\"modifiedHeight\\":%s}",seed,p[0],p[1],rarity,base,(double)easing,center,modified));
   }
  }
  System.out.print("["+rows+"]");
 }
}`,
);

execFileSync('javac', ['-d', work, ...files], { stdio: 'inherit' });
const cases = JSON.parse(
  execFileSync('java', ['-cp', work, 'Capture'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
);
const revision = execFileSync(
  'git',
  ['-c', `safe.directory=${checkout.replaceAll('\\', '/')}`, '-C', checkout, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
).trim();
mkdirSync('tests/fixtures/tfc-1.20', { recursive: true });
writeFileSync(
  'tests/fixtures/tfc-1.20/volcano-noise.json',
  `${JSON.stringify(
    {
      source:
        'Actual TFC 1.20.x VolcanoNoise, Cellular2D, OpenSimplex2D and FastNoiseLite. Minecraft Mth/BlockPos, Nullable and fastutil linkage use minimal shims. Seeds are supplied directly.',
      revision,
      capturedAt: new Date().toISOString(),
      cases,
    },
    null,
    2,
  )}\n`,
);
console.log(`Captured ${cases.length} cases from ${revision}; temporary sources: ${work}`);
