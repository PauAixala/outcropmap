/** Capture TFC 1.20 ChunkBiomeSampler from the actual Java source. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const checkout = resolve(process.argv[2] || '');
const base = join(checkout, 'src/main/java/net/dries007/tfc');
const work = mkdtempSync(join(tmpdir(), 'tfc-chunk-biome-sampler-parity-'));
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

put('net/dries007/tfc/world/ChunkBiomeSampler.java', source('world/ChunkBiomeSampler.java'));
put('net/dries007/tfc/world/Sampler.java', source('world/Sampler.java'));
put('net/dries007/tfc/world/noise/Kernel.java', source('world/noise/Kernel.java'));
put('net/dries007/tfc/world/biome/BiomeBlendType.java', source('world/biome/BiomeBlendType.java'));
put(
  'net/minecraft/world/level/biome/Biome.java',
  'package net.minecraft.world.level.biome; public class Biome {}',
);
put(
  'net/minecraft/world/level/ChunkPos.java',
  'package net.minecraft.world.level; public record ChunkPos(int x,int z){public int getMinBlockX(){return x<<4;}public int getMinBlockZ(){return z<<4;}}',
);
put(
  'it/unimi/dsi/fastutil/objects/ObjectIterator.java',
  'package it.unimi.dsi.fastutil.objects; public interface ObjectIterator<T> extends java.util.Iterator<T> {}',
);
put(
  'it/unimi/dsi/fastutil/objects/Object2DoubleMap.java',
  [
    'package it.unimi.dsi.fastutil.objects;',
    'import java.util.function.DoubleBinaryOperator;',
    'public interface Object2DoubleMap<K>{',
    ' interface Entry<K>{K getKey();double getDoubleValue();}',
    ' interface EntrySet<K> extends Iterable<Entry<K>>{@Override ObjectIterator<Entry<K>> iterator();}',
    ' EntrySet<K> object2DoubleEntrySet(); void clear(); void mergeDouble(K key,double value,DoubleBinaryOperator op); void put(K key,double value);',
    '}',
  ].join('\n'),
);
put(
  'it/unimi/dsi/fastutil/objects/Object2DoubleOpenHashMap.java',
  [
    'package it.unimi.dsi.fastutil.objects;',
    'import java.util.*; import java.util.function.DoubleBinaryOperator;',
    'public class Object2DoubleOpenHashMap<K> implements Object2DoubleMap<K>{',
    ' private final LinkedHashMap<K,Double> map=new LinkedHashMap<>();',
    ' public void clear(){map.clear();} public void put(K k,double v){map.put(k,v);}',
    ' public void mergeDouble(K k,double v,DoubleBinaryOperator op){map.put(k,map.containsKey(k)?op.applyAsDouble(map.get(k),v):v);}',
    ' public EntrySet<K> object2DoubleEntrySet(){return ()->{Iterator<Map.Entry<K,Double>> it=map.entrySet().iterator(); return new ObjectIterator<>(){',
    '  public boolean hasNext(){return it.hasNext();} public Entry<K> next(){Map.Entry<K,Double> e=it.next(); return new Entry<>(){public K getKey(){return e.getKey();} public double getDoubleValue(){return e.getValue();}};} public void remove(){it.remove();}',
    ' };};}',
    '}',
  ].join('\n'),
);
put(
  'Capture.java',
  [
    'import java.util.*; import it.unimi.dsi.fastutil.objects.*; import net.minecraft.world.level.ChunkPos; import net.dries007.tfc.world.*; import net.dries007.tfc.world.biome.BiomeBlendType;',
    'public class Capture{',
    ' static int biome(int x,int z){int qx=Math.floorDiv(x,4),qz=Math.floorDiv(z,4);return Math.floorMod(qx*31+qz*17+qx*qz,30);}',
    ' static BiomeBlendType group(int id){return id<4||id==21?BiomeBlendType.OCEAN:id>=22&&id!=23?BiomeBlendType.LAKE:BiomeBlendType.LAND;}',
    ' static String weights(Object2DoubleMap<Integer> map){List<String> v=new ArrayList<>();for(var e:map.object2DoubleEntrySet())v.add(String.format(Locale.ROOT,\"[%d,%.17g]\",e.getKey(),e.getDoubleValue()));Collections.sort(v);return \"[\"+String.join(\",\",v)+\"]\";}',
    ' public static void main(String[] args){Locale.setDefault(Locale.ROOT);StringJoiner rows=new StringJoiner(\",\");int[][] chunks={{0,0},{-3,5}};int[][] columns={{0,0},{3,7},{8,12},{15,15}};',
    '  for(int[] c:chunks){var corners=ChunkBiomeSampler.sampleBiomes(new ChunkPos(c[0],c[1]),Capture::biome,Capture::group);for(int i=0;i<corners.length;i++)rows.add(String.format(\"{\\\"kind\\\":\\\"corner\\\",\\\"chunkX\\\":%d,\\\"chunkZ\\\":%d,\\\"index\\\":%d,\\\"weights\\\":%s}\",c[0],c[1],i,weights(corners[i])));for(int[] p:columns){Object2DoubleMap<Integer> out=new Object2DoubleOpenHashMap<>();ChunkBiomeSampler.sampleBiomesColumn(out,corners,p[0],p[1]);rows.add(String.format(\"{\\\"kind\\\":\\\"column\\\",\\\"chunkX\\\":%d,\\\"chunkZ\\\":%d,\\\"x\\\":%d,\\\"z\\\":%d,\\\"weights\\\":%s}\",c[0],c[1],p[0],p[1],weights(out)));}}',
    '  System.out.print(\"[\"+rows+\"]\");}',
    '}',
  ].join('\n'),
);

execFileSync('javac', ['-d', work, ...files], { stdio: 'inherit' });
const cases = JSON.parse(execFileSync('java', ['-cp', work, 'Capture'], { encoding: 'utf8' }));
const revision = execFileSync(
  'git',
  ['-c', 'safe.directory=' + checkout.replaceAll('\\', '/'), '-C', checkout, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
).trim();
mkdirSync('tests/fixtures/tfc-1.20', { recursive: true });
writeFileSync(
  'tests/fixtures/tfc-1.20/chunk-biome-sampler.json',
  JSON.stringify(
    {
      source:
        'Actual TFC 1.20.x ChunkBiomeSampler and Kernel with minimal Minecraft and fastutil linkage shims.',
      revision,
      capturedAt: new Date().toISOString(),
      cases,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Captured ' + cases.length + ' cases from ' + revision + '; temporary sources: ' + work,
);
