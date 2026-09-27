/** Capture actual TFC source components; upstream Java stays in an external checkout/temp dir.
 * Usage: node tools/parity/capture-tfc-climate.mjs <TFC checkout>
 * Requires JDK 17. Minecraft/fastutil linkage helpers below are independent minimal shims;
 * this validates TFC components, not an instrumented Minecraft world.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const checkout = resolve(process.argv[2] ?? '');
const base = join(checkout, 'src/main/java/net/dries007/tfc');
const work = mkdtempSync(join(tmpdir(), 'tfc-climate-parity-'));
const files = [];
function put(path, content) {
  const target = join(work, path);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
  files.push(target);
}
function source(path) { return readFileSync(join(base, path), 'utf8'); }
function method(text, signature) {
  const start = text.indexOf(signature);
  if (start < 0) throw new Error(`Missing upstream signature: ${signature}`);
  let end = text.indexOf('{', start), depth = 1;
  while (depth && ++end < text.length) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; }
  if (depth) throw new Error('Unbalanced upstream method');
  return text.slice(start, end + 1);
}
for (const name of ['FastNoiseLite', 'Noise2D', 'OpenSimplex2D', 'Cellular2D']) {
  put(`net/dries007/tfc/world/noise/${name}.java`, source(`world/noise/${name}.java`));
}
put('net/dries007/tfc/world/region/Units.java', source('world/region/Units.java'));
put('it/unimi/dsi/fastutil/HashCommon.java', 'package it.unimi.dsi.fastutil; public class HashCommon { public static int long2int(long v){return (int)(v ^ (v >>> 32));}}');
put('net/minecraft/util/Mth.java', `package net.minecraft.util;
public class Mth {
 public static int floor(double v){int i=(int)v;return v<i?i-1:i;}
 public static double clamp(double v,double lo,double hi){return Math.max(lo,Math.min(hi,v));}
 public static float lerp(float t,float a,float b){return a+t*(b-a);}
 public static float clampedMap(float v,float a,float b,float lo,float hi){return lerp((float)clamp((v-a)/(b-a),0,1),lo,hi);}
}`);
const region = source('world/region/RegionGenerator.java');
const builderStart = region.indexOf('this.temperatureNoise =');
const builderEnd = region.indexOf('final AreaFactory biomeAreaFactory', builderStart);
const builder = region.slice(builderStart, builderEnd);
put('net/dries007/tfc/world/region/RegionGenerator.java', `package net.dries007.tfc.world.region;
import net.minecraft.util.Mth; import net.dries007.tfc.world.noise.*;
public class RegionGenerator {
 ${method(region, 'private static double triangle(')}
 ${method(region, 'private static Noise2D baseNoise(')}
 public final Noise2D temperatureNoise, rainfallNoise;
 public record Settings(int temperatureScale,float temperatureConstant,int rainfallScale,float rainfallConstant){}
 public static class Seeds {int i;int[] seeds;Seeds(int a,int b){seeds=new int[]{a,b};}public int nextInt(){return seeds[i++];}}
 public RegionGenerator(Settings settings,int temperatureSeed,int rainfallSeed){Seeds random=new Seeds(temperatureSeed,rainfallSeed);${builder}}
 public class Context {public Region region; public RegionGenerator generator(){return RegionGenerator.this;}}
}`);
put('net/dries007/tfc/world/region/Region.java', `package net.dries007.tfc.world.region;
public class Region {public Point point=new Point(); public int minX(){return 0;} public int maxX(){return 0;} public int minZ(){return 0;} public int maxZ(){return 0;} public Point maybeAt(int x,int z){return point;}
 public static class Point {public float temperature,rainfall;public int distanceToEdge,distanceToOcean;public boolean isLand;public boolean land(){return isLand;}}
}`);
put('net/dries007/tfc/world/region/RegionTask.java', source('world/region/RegionTask.java'));
put('net/dries007/tfc/world/region/AnnotateClimate.java', source('world/region/AnnotateClimate.java'));
const helpers = source('util/Helpers.java');
put('net/dries007/tfc/util/Helpers.java', `package net.dries007.tfc.util; public class Helpers {${method(helpers,'public static double lerp(')} ${method(helpers,'public static double lerp4(')}}`);
put('it/unimi/dsi/fastutil/floats/FloatUnaryOperator.java', 'package it.unimi.dsi.fastutil.floats; public interface FloatUnaryOperator {float apply(float x);}');
put('net/minecraft/nbt/CompoundTag.java', 'package net.minecraft.nbt; public class CompoundTag {public float getFloat(String s){throw new UnsupportedOperationException();}public void putFloat(String s,float v){throw new UnsupportedOperationException();}}');
put('net/minecraft/network/FriendlyByteBuf.java', 'package net.minecraft.network; public class FriendlyByteBuf {public float readFloat(){throw new UnsupportedOperationException();}public void writeFloat(float v){throw new UnsupportedOperationException();}}');
put('net/dries007/tfc/world/chunkdata/LerpFloatLayer.java', source('world/chunkdata/LerpFloatLayer.java'));
put('Capture.java', `import java.util.*; import net.dries007.tfc.world.noise.*; import net.dries007.tfc.world.region.*; import net.dries007.tfc.world.chunkdata.*;
public class Capture {
 public static void main(String[] args){Locale.setDefault(Locale.ROOT);StringJoiner rows=new StringJoiner(",");
 int[] seeds={0,1,-1,123456789,Integer.MIN_VALUE,Integer.MAX_VALUE};
 double[][] points={{0,0},{1,-1},{-1,-1},{-.00001,.00001},{12.5,-93.25},{-156.25,156.25},{234375,-234375}};
 for(int seed:seeds)for(int octaves:new int[]{1,2,4})for(double[] p:points){double v=new OpenSimplex2D(seed).octaves(octaves).spread(.15f).noise(p[0],p[1]);rows.add(String.format("{\\"kind\\":\\"noise\\",\\"seed\\":%d,\\"octaves\\":%d,\\"x\\":%s,\\"z\\":%s,\\"value\\":%s}",seed,octaves,p[0],p[1],v));}
 for(long seed:new long[]{0,1,-1,123456789,Long.MIN_VALUE,Long.MAX_VALUE})for(double[] p:points){Cellular2D.Cell c=new Cellular2D(seed).spread(1f/96).cell(p[0],p[1]);rows.add(String.format("{\\"kind\\":\\"cell\\",\\"seed\\":\\"%d\\",\\"x\\":%s,\\"z\\":%s,\\"value\\":[%s,%s,%d,%d,%s,%s,%s]}",seed,p[0],p[1],c.x(),c.y(),c.cx(),c.cy(),c.f1(),c.f2(),c.noise()));}
 for(int seed:seeds)for(int scale:new int[]{0,20000,12345})for(float constant:new float[]{-.7f,0,.8f})for(double[] p:points){RegionGenerator g=new RegionGenerator(new RegionGenerator.Settings(scale,constant,scale,constant),seed,~seed);rows.add(String.format("{\\"kind\\":\\"base\\",\\"seed\\":%d,\\"scale\\":%d,\\"constant\\":%s,\\"x\\":%s,\\"z\\":%s,\\"temperature\\":%s,\\"rainfall\\":%s}",seed,scale,(double)constant,p[0],p[1],g.temperatureNoise.noise(p[0],p[1]),g.rainfallNoise.noise(p[0],p[1])));}
 for(float temp:new float[]{-23,5,33})for(float rain:new float[]{-80,250,540})for(int distance:new int[]{0,2,3,5,6,12})for(boolean land:new boolean[]{false,true}){RegionGenerator g=new RegionGenerator(new RegionGenerator.Settings(0,0,0,0),0,0){ };RegionGenerator.Context c=g.new Context();c.region=new Region();c.region.point.isLand=land;c.region.point.distanceToEdge=distance;c.region.point.distanceToOcean=6; // capture real correction with controlled constant fields via separate scalar generator
 RegionGenerator fixed=new RegionGenerator(new RegionGenerator.Settings(0,(temp-5)/25,0,(rain+20-250)/250),0,0);c=fixed.new Context();c.region=new Region();c.region.point.isLand=land;c.region.point.distanceToEdge=distance;c.region.point.distanceToOcean=6;double initialT=fixed.temperatureNoise.noise(0,0),initialR=fixed.rainfallNoise.noise(0,0);AnnotateClimate.INSTANCE.apply(c);
 rows.add(String.format("{\\"kind\\":\\"correction\\",\\"temperature\\":%s,\\"rainfall\\":%s,\\"land\\":%s,\\"edge\\":%d,\\"ocean\\":6,\\"value\\":[%s,%s]}",initialT,initialR,land,distance,(double)c.region.point.temperature,(double)c.region.point.rainfall));}
 for(double dx:new double[]{0,.125,.875})for(double dz:new double[]{0,.375,.875})for(int x:new int[]{0,1,15})for(int z:new int[]{0,7,15}){LerpFloatLayer l=new LerpFloatLayer(-22.13f,32.7f,14.37f,-3.11f).scaled(dx,dz,.125);rows.add(String.format("{\\"kind\\":\\"lerp\\",\\"dx\\":%s,\\"dz\\":%s,\\"x\\":%d,\\"z\\":%d,\\"value\\":%s}",dx,dz,x,z,(double)l.getValue(x/16f,z/16f)));}
 System.out.print("["+rows+"]");
 }
}`);
execFileSync('javac', ['-d', work, ...files], { stdio: 'inherit' });
const cases = JSON.parse(execFileSync('java', ['-cp', work, 'Capture'], { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }));
const revision = execFileSync('git', ['-c', `safe.directory=${checkout.replaceAll('\\','/')}`, '-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
mkdirSync('tests/fixtures/tfc-1.20', {recursive:true});
writeFileSync('tests/fixtures/tfc-1.20/climate-components.json', JSON.stringify({source:'Actual TFC 1.20.x OpenSimplex2D, FastNoiseLite, Cellular2D, RegionGenerator climate constructor expressions, AnnotateClimate.apply, LerpFloatLayer and Helpers.lerp4. Minecraft Mth/fastutil linkage uses independent minimal shims. Seeds supplied directly; not a world-seed or in-game fixture.',revision,capturedAt:new Date().toISOString(),cases}, null, 2)+'\n');
console.log(`Captured ${cases.length} cases from ${revision}; temporary sources: ${work}`);
