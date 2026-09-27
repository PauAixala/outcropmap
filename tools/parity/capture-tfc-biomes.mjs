/** Runs actual TFC 1.20 source with the official Minecraft 1.20.1 RNG/math binary.
 * Upstream source and binaries remain external, never bundled or checked in.
 * Usage: node tools/parity/capture-tfc-biomes.mjs <TFC checkout> <MC extracted server dir>
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const checkout = resolve(process.argv[2]);
const mc = resolve(process.argv[3]);
const root = join(checkout,'src/main/java/net/dries007/tfc');
const work = mkdtempSync(join(tmpdir(),'tfc-biomes-parity-'));
const files=[];
function source(p){return readFileSync(join(root,p),'utf8');}
function put(p,s){const f=join(work,p);mkdirSync(resolve(f,'..'),{recursive:true});writeFileSync(f,s);files.push(f);}
function copy(p){put('net/dries007/tfc/'+p,source(p));}
function method(s,signature){const start=s.indexOf(signature);if(start<0)throw Error(signature);let end=s.indexOf('{',start),depth=1;while(depth&&++end<s.length){if(s[end]==='{')depth++;if(s[end]==='}')depth--;}if(depth)throw Error(signature);return s.slice(start,end+1);}
function walk(p){return readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);}
for(const p of ['world/region','world/layer/framework'])for(const name of readdirSync(join(root,p))){if(name.endsWith('.java')&&name!=='package-info.java')copy(p+'/'+name);}
for(const name of ['MoreShoresLayer','RegionBiomeLayer','RegionEdgeBiomeLayer','RegionLayer','ShoreLayer','SmoothLayer','UniformLayer','ZoomLayer'])copy('world/layer/'+name+'.java');
for(const name of ['FastNoiseLite','Noise2D','OpenSimplex2D','Cellular2D'])copy('world/noise/'+name+'.java');
for(const name of ['River','RiverHelpers','MidpointFractal'])copy('world/river/'+name+'.java');
copy('world/FastConcurrentCache.java');
put('net/dries007/tfc/world/river/Flow.java','package net.dries007.tfc.world.river; public class Flow {public static Flow fromAngle(double a){throw new UnsupportedOperationException("Flow is not sampled");}}');
for(const name of ['Nullable','TestOnly','VisibleForTesting'])put('org/jetbrains/annotations/'+name+'.java',`package org.jetbrains.annotations; public @interface ${name} {}`);
put('net/dries007/tfc/world/settings/Settings.java',`package net.dries007.tfc.world.settings; public record Settings(int temperatureScale,float temperatureConstant,int rainfallScale,float rainfallConstant,float continentalness){}`);
put('net/minecraft/world/level/ChunkPos.java','package net.minecraft.world.level; public class ChunkPos {public static long asLong(int x,int z){return (x&0xffffffffL)|((z&0xffffffffL)<<32);}}');
const helpers=source('util/Helpers.java');
put('net/dries007/tfc/util/Helpers.java',`package net.dries007.tfc.util;public class Helpers {${method(helpers,'public static double lerp(')}}`);
const tfc=source('world/layer/TFCLayers.java');
const ids=[...tfc.matchAll(/([A-Z_]+) = register\(\(\) -> TFCBiomes\.([A-Z_]+)\);/g)].map(m=>m[1]);
put('net/dries007/tfc/world/layer/TFCLayers.java',`package net.dries007.tfc.world.layer;import java.util.Random;import net.minecraft.util.RandomSource;import net.dries007.tfc.world.layer.framework.*;import net.dries007.tfc.world.region.*;
public class TFCLayers {${ids.map((n,i)=>`public static final int ${n}=${i};`).join('\n')}
${['public static AreaFactory createRegionBiomeLayer(','public static AreaFactory createUniformLayer(','public static boolean hasShore(','public static int shoreFor(','public static boolean hasLake(','public static int lakeFor(','public static boolean isOcean(','public static boolean isMountains(','public static boolean isLow('].map(s=>method(tfc,s)).join('\n')}}`);
// A tiny reflection bridge calls the original obfuscated Minecraft classes, selected using
// the official mappings, rather than reimplementing their numeric behavior in this harness.
const mappings=readFileSync(join(mc,'server-mappings.txt'),'utf8');
function mappedClass(name){const m=mappings.match(new RegExp('^'+name.replaceAll('.','\\.')+' -> ([^:]+):','m'));if(!m)throw Error(name);return m[1];}
function mappedMethod(owner,signature){const block=mappings.split(owner+' -> ')[1]?.split('\n').slice(1).join('\n').split(/\n\S/)[0];const row=block?.split('\n').find(l=>l.includes(signature+' -> '));if(!row)throw Error(signature);return row.split(' -> ')[1].trim();}
put('fixture/Minecraft.java',`package fixture;import java.lang.reflect.*;import java.util.*;public class Minecraft {
 static final Map<String,Method> methods=new HashMap<>();
 public static Object construct(String cls,long seed){try{return Class.forName(cls).getConstructor(long.class).newInstance(seed);}catch(Exception e){throw new RuntimeException(e);}}
 public static Object call(String cls,String name,Object target,Class<?>[] types,Object...args){try{String key=cls+name+Arrays.toString(types);Method m=methods.get(key);if(m==null){m=Class.forName(cls).getMethod(name,types);methods.put(key,m);}return m.invoke(target,args);}catch(Exception e){throw new RuntimeException(e);}}
}`);
const rngOwner='net.minecraft.world.level.levelgen.XoroshiroRandomSource';
const rngMethods=[['void','setSeed','long','seed'],['int','nextInt','',''],['int','nextInt','int','bound'],['long','nextLong','',''],['boolean','nextBoolean','',''],['float','nextFloat','',''],['double','nextDouble','','']];
put('net/minecraft/util/RandomSource.java',`package net.minecraft.util;public interface RandomSource {${rngMethods.map(([r,n,t,a])=>`${r} ${n}(${t} ${a});`).join('\n')}}`);
put('net/minecraft/world/level/levelgen/XoroshiroRandomSource.java',`package net.minecraft.world.level.levelgen;import fixture.Minecraft;import net.minecraft.util.RandomSource;public class XoroshiroRandomSource implements RandomSource {
 private final Object rng;public XoroshiroRandomSource(long seed){rng=Minecraft.construct("${mappedClass(rngOwner)}",seed);}
 ${rngMethods.map(([r,n,t,a])=>`public ${r} ${n}(${t} ${a}){${r==='void'?'':`return (${r})`}Minecraft.call("${mappedClass(rngOwner)}","${mappedMethod(rngOwner,r+' '+n+'('+t+')')}",rng,new Class<?>[]{${t?t+'.class':''}}${a?','+a:''});}`).join('\n')}
}`);
const mthOwner='net.minecraft.util.Mth';
const mthMethods=[['int','floor','double'],['int','ceil','float'],['double','clamp','double,double,double'],['float','lerp','float,float,float'],['float','clampedMap','float,float,float,float,float'],['int','smallestEncompassingPowerOfTwo','int'],['float','sin','float'],['float','cos','float'],['double','atan2','double,double']];
put('net/minecraft/util/Mth.java',`package net.minecraft.util;import fixture.Minecraft;public class Mth {${mthMethods.map(([r,n,ts])=>{const t=ts.split(',');return `public static ${r} ${n}(${t.map((v,i)=>v+' a'+i).join(',')}){return (${r})Minecraft.call("${mappedClass(mthOwner)}","${mappedMethod(mthOwner,r+' '+n+'('+ts+')')}",null,new Class<?>[]{${t.map(v=>v+'.class').join(',')}},${t.map((_,i)=>'a'+i).join(',')});}`;}).join('\n')}}`);
put('fixture/CaptureBiomes.java',`package fixture;import java.util.*;import java.nio.file.*;import net.minecraft.world.level.levelgen.XoroshiroRandomSource;import net.dries007.tfc.world.region.*;import net.dries007.tfc.world.settings.Settings;import net.dries007.tfc.world.layer.*;import net.dries007.tfc.world.layer.framework.*;
public class CaptureBiomes {
 public static void main(String[] args)throws Exception {Locale.setDefault(Locale.ROOT);StringJoiner cases=new StringJoiner(",");
 for(long seed:new long[]{0,42,-123456789}){XoroshiroRandomSource random=new XoroshiroRandomSource(seed);RegionGenerator g=new RegionGenerator(new Settings(20000,0,20000,0,.5f),random);random.nextLong();long biomeSeed=random.nextLong();Area area=TFCLayers.createRegionBiomeLayer(g,biomeSeed).get();
 StringJoiner points=new StringJoiner(","),quarts=new StringJoiner(","),rivers=new StringJoiner(",");Set<Region> seen=Collections.newSetFromMap(new IdentityHashMap<>());
 for(int x=-192;x<=192;x+=24)for(int z=-192;z<=192;z+=24){Region r=g.getOrCreateRegion(x,z);Region.Point p=g.getOrCreateRegionPoint(x,z);points.add(point(x,z,p));
 if(seen.add(r)){int count=0;for(RiverEdge e:r.rivers()){if(count++>=3)break;StringJoiner segments=new StringJoiner(",");for(double v:e.fractal().segments)segments.add(Double.toString(v));rivers.add(String.format("{\\"gridX\\":%d,\\"gridZ\\":%d,\\"index\\":%d,\\"width\\":%d,\\"source\\":[%s,%s],\\"drain\\":[%s,%s],\\"segments\\":[%s]}",x,z,count-1,e.width,e.source().x(),e.source().y(),e.drain().x(),e.drain().y(),segments));}
 // Include coast/mountain/lake transitions selected from the actual region, not only regular samples.
 int special=0;for(int gx=r.minX();gx<=r.maxX()&&special<8;gx++)for(int gz=r.minZ();gz<=r.maxZ()&&special<8;gz++){Region.Point q=r.maybeAt(gx,gz);if(q!=null&&(q.shore()||q.mountain()||q.biome>=TFCLayers.LAKE)){points.add(point(gx,gz,q));for(int dx:new int[]{-1,0,1,15,31,32}){int qx=gx*32+dx,qz=gz*32+dx;quarts.add(String.format("[%d,%d,%d]",qx,qz,area.get(qx,qz)));}special++;}}
 }
 quarts.add(String.format("[%d,%d,%d]",x*32+7,z*32-3,area.get(x*32+7,z*32-3)));
 }
 cases.add(String.format("{\\"seed\\":\\"%d\\",\\"biomeSeed\\":\\"%d\\",\\"points\\":[%s],\\"quarts\\":[%s],\\"rivers\\":[%s]}",seed,biomeSeed,points,quarts,rivers));System.err.println("Captured seed "+seed+" regions "+seen.size());}
 Files.writeString(Path.of(args[0]),"["+cases+"]");}
 static String point(int x,int z,Region.Point p){return String.format("{\\"x\\":%d,\\"z\\":%d,\\"biome\\":%d,\\"rock\\":%d,\\"edge\\":%d,\\"ocean\\":%d,\\"landHeight\\":%d,\\"oceanDepth\\":%d,\\"altitude\\":%d,\\"land\\":%s,\\"island\\":%s,\\"mountain\\":%s,\\"coastalMountain\\":%s,\\"river\\":%s,\\"temperature\\":%s,\\"rainfall\\":%s}",x,z,p.biome,p.rock,p.distanceToEdge,p.distanceToOcean,p.baseLandHeight,p.baseOceanDepth,p.biomeAltitude,p.land(),p.island(),p.mountain(),p.coastalMountain(),p.river(),(double)p.temperature,(double)p.rainfall);}
}`);
const jars=walk(join(mc,'META-INF')).filter(p=>p.endsWith('.jar'));
const classpath=[work,...jars].join(delimiter);
execFileSync('javac',['-cp',classpath,'-d',work,...files],{stdio:'inherit'});
const output=join(work,'biomes.json');
execFileSync('java',['-Xmx2g','-cp',classpath,'fixture.CaptureBiomes',output],{stdio:'inherit',timeout:600000});
const revision=execFileSync('git',['-c',`safe.directory=${checkout.replaceAll('\\','/')}`,'-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const fixture={source:'Unmodified TFC RegionGenerator full task pipeline and TFCLayers.createRegionBiomeLayer, original layer/river/noise classes; actual official Minecraft 1.20.1 XoroshiroRandomSource and Mth through mapped reflection. Only Settings/registry identities and noncomputational linkage are shimmed. A source execution fixture, not generated-world observations.',revision,capturedAt:new Date().toISOString(),biomeIds:ids,cases:JSON.parse(readFileSync(output,'utf8'))};
mkdirSync('tests/fixtures/tfc-1.20',{recursive:true});writeFileSync('tests/fixtures/tfc-1.20/biomes.json',JSON.stringify(fixture,null,2)+'\n');console.log(`Captured ${fixture.cases.length} seeds; temporary source: ${work}`);

