package fixture;

import java.nio.file.*;
import java.util.*;
import com.google.gson.GsonBuilder;

/** Calls real Minecraft 1.20.1 classes, with names from Mojang's official server mappings:
 * dil = XoroshiroRandomSource, dhz = RandomSupport, apa = Mth. No algorithms are duplicated.
 * Compiled only by capture-minecraft.mjs with an external official server bundle classpath.
 */
public class MinecraftRandomFixture {
    static Object call(String owner,Object target,String name,Class<?>[] types,Object...args) {
        try { return Class.forName(owner).getMethod(name,types).invoke(target,args); }
        catch(ReflectiveOperationException e) { throw new RuntimeException(e); }
    }
    static Object make(String owner,Class<?>[] types,Object...args) {
        try { return Class.forName(owner).getConstructor(types).newInstance(args); }
        catch(ReflectiveOperationException e) { throw new RuntimeException(e); }
    }
    static final Class<?>[] NONE={}, LONG={long.class}, TWO_LONGS={long.class,long.class};
    static class apf {
        final Object actual; apf(Object actual){this.actual=actual;}
        long g(){return (long)call("dil",actual,"g",NONE);}
    }
    static class dil extends apf {
        dil(long seed){super(make("dil",LONG,seed));}
        dil(long lo,long hi){super(make("dil",TWO_LONGS,lo,hi));}
        int f(){return (int)call("dil",actual,"f",NONE);}
        int a(int bound){return (int)call("dil",actual,"a",new Class<?>[]{int.class},bound);}
        double j(){return (double)call("dil",actual,"j",NONE);}
        double k(){return (double)call("dil",actual,"k",NONE);}
        float i(){return (float)call("dil",actual,"i",NONE);}
        boolean h(){return (boolean)call("dil",actual,"h",NONE);}
        static class a {
            final Object actual; a(long lo,long hi){actual=make("dil$a",TWO_LONGS,lo,hi);}
            apf a(int x,int y,int z){return new apf(call("dil$a",actual,"a",new Class<?>[]{int.class,int.class,int.class},x,y,z));}
            apf a(String name){return new apf(call("dil$a",actual,"a",new Class<?>[]{String.class},name));}
        }
    }
    static class dhz {
        static a c(long seed){return new a(call("dhz",null,"c",LONG,seed));}
        record a(Object actual) {
            long b(){return (long)call("dhz$a",actual,"b",NONE);}
            long c(){return (long)call("dhz$a",actual,"c",NONE);}
        }
    }
    static class apa {
        static long b(int x,int y,int z){return (long)call("apa",null,"b",new Class<?>[]{int.class,int.class,int.class},x,y,z);}
    }
    static final List<Map<String,Object>> cases = new ArrayList<>();
    static Map<String,Object> row(String op) {
        Map<String,Object> row = new LinkedHashMap<>(); row.put("op",op); cases.add(row); return row;
    }
    public static void main(String[] args) throws Exception {
        long[] seeds = {0,1,-1,42,123456789,-987654321,Long.MIN_VALUE,Long.MAX_VALUE};
        for(long seed:seeds) {
            dhz.a pair = dhz.c(seed);
            Map<String,Object> upgrade = row("upgradeSeedTo128bit");
            upgrade.put("seed",String.valueOf(seed)); upgrade.put("lo",String.valueOf(pair.b())); upgrade.put("hi",String.valueOf(pair.c()));
            for(String op:List.of("nextLong","nextInt","nextDouble","nextFloat","nextBoolean","nextGaussian","mixed")) {
                dil rng = new dil(seed); Map<String,Object> r = row(op); r.put("seed",String.valueOf(seed));
                List<Object> out = new ArrayList<>();
                for(int i=0;i<16;i++) switch(op) {
                    case "nextLong": out.add(String.valueOf(rng.g())); break;
                    case "nextInt": out.add(rng.f()); break;
                    case "nextDouble": out.add(rng.j()); break;
                    case "nextFloat": out.add((double)rng.i()); break;
                    case "nextBoolean": out.add(rng.h()); break;
                    case "nextGaussian": out.add(rng.k()); break;
                    case "mixed": rng.h(); rng.j(); rng.a(1073741825); out.add(String.valueOf(rng.g())); break;
                }
                r.put("n",out.size()); r.put("out",out);
            }
            for(int bound:new int[]{1,2,37,64,100000,1073741825,Integer.MAX_VALUE}) {
                dil rng = new dil(seed); Map<String,Object> r=row("nextIntBound");r.put("seed",String.valueOf(seed));r.put("bound",bound);
                List<Integer> out = new ArrayList<>();for(int i=0;i<32;i++)out.add(rng.a(bound));r.put("n",out.size());r.put("out",out);
            }
        }
        int[][] positions={{0,0,0},{1,2,3},{-1,-2,-3},{1000000,64,-1000000},{Integer.MIN_VALUE,0,Integer.MAX_VALUE}};
        for(int[] p:positions) {
            Map<String,Object> r=row("positionalSeed");r.put("x",p[0]);r.put("y",p[1]);r.put("z",p[2]);r.put("out",String.valueOf(apa.b(p[0],p[1],p[2])));
        }
        for(long seed:new long[]{0,42,-1234567890123L}) {
            dhz.a pair=dhz.c(seed);dil.a factory=new dil.a(pair.b(),pair.c());
            for(int[] p:positions) {
                apf rng=factory.a(p[0],p[1],p[2]);Map<String,Object> r=row("positionalFactoryAt");
                r.put("baseSeed",String.valueOf(seed));r.put("x",p[0]);r.put("y",p[1]);r.put("z",p[2]);
                List<String> out=new ArrayList<>();for(int i=0;i<4;i++)out.add(String.valueOf(rng.g()));r.put("n",4);r.put("out",out);
            }
            for(String name:List.of("minecraft:ore_vein","tfc:cluster_vein","","ñ🌍","a".repeat(80))) {
                apf rng=factory.a(name);Map<String,Object> r=row("positionalFactoryFromHashOf");r.put("baseSeed",String.valueOf(seed));r.put("name",name);
                List<String> out=new ArrayList<>();for(int i=0;i<4;i++)out.add(String.valueOf(rng.g()));r.put("n",4);r.put("out",out);
            }
        }
        dil zero=new dil(0L,0L);Map<String,Object> zr=row("zeroState");List<String> zo=new ArrayList<>();for(int i=0;i<4;i++)zo.add(String.valueOf(zero.g()));zr.put("out",zo);
        for(float angle:new float[]{0,.1f,-.1f,1,-1,3.1415927f,-1000,1000,6.2831855f}) {
            Map<String,Object> r=row("trig");r.put("angle",(double)angle);
            r.put("sin",(double)(float)call("apa",null,"a",new Class<?>[]{float.class},angle));
            r.put("cos",(double)(float)call("apa",null,"b",new Class<?>[]{float.class},angle));
        }
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("source","Official Minecraft Java 1.20.1 server: XoroshiroRandomSource, RandomSupport, Mth, positional factory; direct JVM invocation using Mojang server mappings.");
        result.put("capturedAt",java.time.Instant.now().toString());result.put("cases",cases);
        Files.writeString(Path.of(args[0]),new GsonBuilder().setPrettyPrinting().create().toJson(result));
        System.out.println("Captured "+cases.size()+" actual Minecraft RNG cases");
    }
}
