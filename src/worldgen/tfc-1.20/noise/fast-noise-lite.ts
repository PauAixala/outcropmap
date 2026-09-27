/**
 * A from-scratch TypeScript port of the specific slice of FastNoiseLite (Jordan Peck / Auburn,
 * MIT licence, version 1.0.1, https://github.com/Auburn/FastNoiseLite) that TFC's region generator
 * configures: `NoiseType.OpenSimplex2S` (2D, single-octave and FBm fractal) and TFC's own
 * `Cellular2D` (F1/F2 cell distances, built directly on FastNoiseLite's `Hash` + `RandVecs2D`,
 * bypassing FastNoiseLite's own `NoiseType.Cellular`). FastNoiseLite is a third-party MIT-licensed
 * library TFC vendors unmodified at `world/noise/FastNoiseLite.java` — not TFC's own EUPL code —
 * so this is reproducing a public, permissively-licensed noise algorithm TFC depends on, the same
 * way `src/core/noise/improved-noise.ts` reproduces vanilla's public-domain Perlin noise. No
 * FastNoiseLite Java source is copied into this repository (CLAUDE.md section 7b/8): every function
 * here is written from reading the algorithm, and the Java reimplementation used to build
 * `tests/fixtures/tfc-1.20/fast-noise-lite.json` (`tools/parity/src/FastNoiseLiteFixture.java`) is
 * likewise an independent reimplementation, not a copy of the vendored file.
 *
 * Domain warp, 3D noise, and every `NoiseType` except `OpenSimplex2S` are not ported — TFC's
 * `RegionGenerator`/`Region` pipeline (the climate-relevant slice) never configures them.
 *
 * @unverified against real TFC/Minecraft output — no decompiled Mojang or TFC binary is available
 * in this environment (CLAUDE.md section 8). The accompanying fixture is JDK-executed against an
 * independent Java reimplementation of the same public FastNoiseLite algorithm (see
 * tools/parity/src/FastNoiseLiteFixture.java and docs/PARITY.md); it confirms this port's 32-bit
 * int hashing, gradient lookups and float-rounding behaviour reproduce that algorithm bit-for-bit
 * on a real JVM, not that it is byte-identical to what a specific TFC build ships.
 */
import { toFloat32, toInt64, unsignedRightShift64 } from '@core/math';

/** `FastNoiseLite.PrimeX` / `PrimeY`. */
export const PRIME_X = 501125321;
export const PRIME_Y = 1136930381;

/** `FastNoiseLite.Hash(int seed, int xPrimed, int yPrimed)`: a pure 32-bit int hash. */
export function hash2D(seed: number, xPrimed: number, yPrimed: number): number {
  let hash = (seed ^ xPrimed ^ yPrimed) | 0;
  hash = Math.imul(hash, 0x27d4eb2d);
  return hash | 0;
}

/**
 * `FastNoiseLite.Gradients2D`: 128 unit vectors (as 256 interleaved x/y floats), used by
 * `GradCoord` for OpenSimplex2/2S gradient lookups. Public data table from the MIT-licensed
 * FastNoiseLite library — see the file header.
 */
/** Exported for the domain-warp port, which indexes the same table. */
export const GRADIENTS_2D_TABLE: readonly number[] = [
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509, 0.923879532511287, -0.38268343236509, 0.38268343236509, -0.923879532511287,
  -0.38268343236509, -0.923879532511287, -0.923879532511287, -0.38268343236509, -0.923879532511287, 0.38268343236509, -0.38268343236509, 0.923879532511287,
];
/**
 * The same gradients as `GRADIENTS_2D_TABLE`, narrowed to float32 once. Every read of a
 * `Float32Array` returns a float32-rounded value, which is exactly what the per-call `toFloat32`
 * was computing — same numbers, none of the work.
 */
const GRADIENTS_2D_F32 = Float32Array.from(GRADIENTS_2D_TABLE);

/**
 * `FastNoiseLite.GradCoord(int seed, int xPrimed, int yPrimed, float xd, float yd)`: dot the
 * gradient at this lattice point with the offset `(xd, yd)`.
 */
function gradCoord2D(seed: number, xPrimed: number, yPrimed: number, xd: number, yd: number): number {
  let hash = hash2D(seed, xPrimed, yPrimed);
  hash ^= hash >> 15;
  hash &= 127 << 1;
  // `Gradients2D` is a Java `float[]` — each entry is already float32-rounded, and `xd * xg` is a
  // Java `float * float` (single-precision) multiply. The table below is written as double
  // literals for readability, so `xg`/`yg` must be narrowed to float32 *before* multiplying:
  // `double(xd) * double(xg_full_precision)` rounded to float32 at the end is not always the same
  // value as `float32(xd) * float32(xg)` computed directly, and the two disagree in the last ULP
  // often enough to break bit-exactness (confirmed against a real-JVM trace during Phase 3).
  // Reading a `Float32Array` *is* the narrowing: the table below holds the same values
  // `toFloat32` produced on every call before, rounded once at startup instead.
  const xg = GRADIENTS_2D_F32[hash] ?? 0;
  const yg = GRADIENTS_2D_F32[hash | 1] ?? 0;
  return toFloat32(toFloat32(xd * xg) + toFloat32(yd * yg));
}

/** `FastNoiseLite.FastFloor(double f)`. */
export function fastFloor(f: number): number {
  return f >= 0 ? Math.trunc(f) : Math.trunc(f) - 1;
}

/** `FastNoiseLite.FastRound(double f)`, used by `Cellular2D`'s caller (`Region.java`) for cell centres. */
export function fastRound(f: number): number {
  return f >= 0 ? Math.trunc(f + 0.5) : Math.trunc(f - 0.5);
}

export function fastMin(a: number, b: number): number {
  return a < b ? a : b;
}

export function fastMax(a: number, b: number): number {
  return a > b ? a : b;
}

/**
 * `FastNoiseLite.RandVecs2D`: 256 jittered unit vectors (as 512 interleaved x/y floats), used
 * directly by TFC's own `Cellular2D.cell()` (which reimplements the F1/F2 search loop itself
 * rather than calling `FastNoiseLite.SingleCellular`). Public data table — see the file header.
 */
export const RAND_VECS_2D: readonly number[] = [
  -0.2700222198, -0.9628540911, 0.3863092627, -0.9223693152, 0.04444859006, -0.999011673, -0.5992523158, -0.8005602176,
  -0.7819280288, 0.6233687174, 0.9464672271, 0.3227999196, -0.6514146797, -0.7587218957, 0.9378472289, 0.347048376,
  -0.8497875957, -0.5271252623, -0.879042592, 0.4767432447, -0.892300288, -0.4514423508, -0.379844434, -0.9250503802,
  -0.9951650832, 0.0982163789, 0.7724397808, -0.6350880136, 0.7573283322, -0.6530343002, -0.9928004525, -0.119780055,
  -0.0532665713, 0.9985803285, 0.9754253726, -0.2203300762, -0.7665018163, 0.6422421394, 0.991636706, 0.1290606184,
  -0.994696838, 0.1028503788, -0.5379205513, -0.84299554, 0.5022815471, -0.8647041387, 0.4559821461, -0.8899889226,
  -0.8659131224, -0.5001944266, 0.0879458407, -0.9961252577, -0.5051684983, 0.8630207346, 0.7753185226, -0.6315704146,
  -0.6921944612, 0.7217110418, -0.5191659449, -0.8546734591, 0.8978622882, -0.4402764035, -0.1706774107, 0.9853269617,
  -0.9353430106, -0.3537420705, -0.9992404798, 0.03896746794, -0.2882064021, -0.9575683108, -0.9663811329, 0.2571137995,
  -0.8759714238, -0.4823630009, -0.8303123018, -0.5572983775, 0.05110133755, -0.9986934731, -0.8558373281, -0.5172450752,
  0.09887025282, 0.9951003332, 0.9189016087, 0.3944867976, -0.2439375892, -0.9697909324, -0.8121409387, -0.5834613061,
  -0.9910431363, 0.1335421355, 0.8492423985, -0.5280031709, -0.9717838994, -0.2358729591, 0.9949457207, 0.1004142068,
  0.6241065508, -0.7813392434, 0.662910307, 0.7486988212, -0.7197418176, 0.6942418282, -0.8143370775, -0.5803922158,
  0.104521054, -0.9945226741, -0.1065926113, -0.9943027784, 0.445799684, -0.8951327509, 0.105547406, 0.9944142724,
  -0.992790267, 0.1198644477, -0.8334366408, 0.552615025, 0.9115561563, -0.4111755999, 0.8285544909, -0.5599084351,
  0.7217097654, -0.6921957921, 0.4940492677, -0.8694339084, -0.3652321272, -0.9309164803, -0.9696606758, 0.2444548501,
  0.08925509731, -0.996008799, 0.5354071276, -0.8445941083, -0.1053576186, 0.9944343981, -0.9890284586, 0.1477251101,
  0.004856104961, 0.9999882091, 0.9885598478, 0.1508291331, 0.9286129562, -0.3710498316, -0.5832393863, -0.8123003252,
  0.3015207509, 0.9534596146, -0.9575110528, 0.2883965738, 0.9715802154, -0.2367105511, 0.229981792, 0.9731949318,
  0.955763816, -0.2941352207, 0.740956116, 0.6715534485, -0.9971513787, -0.07542630764, 0.6905710663, -0.7232645452,
  -0.290713703, -0.9568100872, 0.5912777791, -0.8064679708, -0.9454592212, -0.325740481, 0.6664455681, 0.74555369,
  0.6236134912, 0.7817328275, 0.9126993851, -0.4086316587, -0.8191762011, 0.5735419353, -0.8812745759, -0.4726046147,
  0.9953313627, 0.09651672651, 0.9855650846, -0.1692969699, -0.8495980887, 0.5274306472, 0.6174853946, -0.7865823463,
  0.8508156371, 0.52546432, 0.9985032451, -0.05469249926, 0.1971371563, -0.9803759185, 0.6607855748, -0.7505747292,
  -0.03097494063, 0.9995201614, -0.6731660801, 0.739491331, -0.7195018362, -0.6944905383, 0.9727511689, 0.2318515979,
  0.9997059088, -0.0242506907, 0.4421787429, -0.8969269532, 0.9981350961, -0.061043673, -0.9173660799, -0.3980445648,
  -0.8150056635, -0.5794529907, -0.8789331304, 0.4769450202, 0.0158605829, 0.999874213, -0.8095464474, 0.5870558317,
  -0.9165898907, -0.3998286786, -0.8023542565, 0.5968480938, -0.5176737917, 0.8555780767, -0.8154407307, -0.5788405779,
  0.4022010347, -0.9155513791, -0.9052556868, -0.4248672045, 0.7317445619, 0.6815789728, -0.5647632201, -0.8252529947,
  -0.8403276335, -0.5420788397, -0.9314281527, 0.363925262, 0.5238198472, 0.8518290719, 0.7432803869, -0.6689800195,
  -0.985371561, -0.1704197369, 0.4601468731, 0.88784281, 0.825855404, 0.5638819483, 0.6182366099, 0.7859920446,
  0.8331502863, -0.553046653, 0.1500307506, 0.9886813308, -0.662330369, -0.7492119075, -0.668598664, 0.743623444,
  0.7025606278, 0.7116238924, -0.5419389763, -0.8404178401, -0.3388616456, 0.9408362159, 0.8331530315, 0.5530425174,
  -0.2989720662, -0.9542618632, 0.2638522993, 0.9645630949, 0.124108739, -0.9922686234, -0.7282649308, -0.6852956957,
  0.6962500149, 0.7177993569, -0.9183535368, 0.3957610156, -0.6326102274, -0.7744703352, -0.9331891859, -0.359385508,
  -0.1153779357, -0.9933216659, 0.9514974788, -0.3076565421, -0.08987977445, -0.9959526224, 0.6678496916, 0.7442961705,
  0.7952400393, -0.6062947138, -0.6462007402, -0.7631674805, -0.2733598753, 0.9619118351, 0.9669590226, -0.254931851,
  -0.9792894595, 0.2024651934, -0.5369502995, -0.8436138784, -0.270036471, -0.9628500944, -0.6400277131, 0.7683518247,
  -0.7854537493, -0.6189203566, 0.06005905383, -0.9981948257, -0.02455770378, 0.9996984141, -0.65983623, 0.751409442,
  -0.6253894466, -0.7803127835, -0.6210408851, -0.7837781695, 0.8348888491, 0.5504185768, -0.1592275245, 0.9872419133,
  0.8367622488, 0.5475663786, -0.8675753916, -0.4973056806, -0.2022662628, -0.9793305667, 0.9399189937, 0.3413975472,
  0.9877404807, -0.1561049093, -0.9034455656, 0.4287028224, 0.1269804218, -0.9919052235, -0.3819600854, 0.924178821,
  0.9754625894, 0.2201652486, -0.3204015856, -0.9472818081, -0.9874760884, 0.1577687387, 0.02535348474, -0.9996785487,
  0.4835130794, -0.8753371362, -0.2850799925, -0.9585037287, -0.06805516006, -0.99768156, -0.7885244045, -0.6150034663,
  0.3185392127, -0.9479096845, 0.8880043089, 0.4598351306, 0.6476921488, -0.7619021462, 0.9820241299, 0.1887554194,
  0.9357275128, -0.3527237187, -0.8894895414, 0.4569555293, 0.7922791302, 0.6101588153, 0.7483818261, 0.6632681526,
  -0.7288929755, -0.6846276581, 0.8729032783, -0.4878932944, 0.8288345784, 0.5594937369, 0.08074567077, 0.9967347374,
  0.9799148216, -0.1994165048, -0.580730673, -0.8140957471, -0.4700049791, -0.8826637636, 0.2409492979, 0.9705377045,
  0.9437816757, -0.3305694308, -0.8927998638, -0.4504535528, -0.8069622304, 0.5906030467, 0.06258973166, 0.9980393407,
  -0.9312597469, 0.3643559849, 0.5777449785, 0.8162173362, -0.3360095855, -0.941858566, 0.697932075, -0.7161639607,
  -0.002008157227, -0.9999979837, -0.1827294312, -0.9831632392, -0.6523911722, 0.7578824173, -0.4302626911, -0.9027037258,
  -0.9985126289, -0.05452091251, -0.01028102172, -0.9999471489, -0.4946071129, 0.8691166802, -0.2999350194, 0.9539596344,
  0.8165471961, 0.5772786819, 0.2697460475, 0.962931498, -0.7306287391, -0.6827749597, -0.7590952064, -0.6509796216,
  -0.907053853, 0.4210146171, -0.5104861064, -0.8598860013, 0.8613350597, 0.5080373165, 0.5007881595, -0.8655698812,
  -0.654158152, 0.7563577938, -0.8382755311, -0.545246856, 0.6940070834, 0.7199681717, 0.06950936031, 0.9975812994,
  0.1702942185, -0.9853932612, 0.2695973274, 0.9629731466, 0.5519612192, -0.8338697815, 0.225657487, -0.9742067022,
  0.4215262855, -0.9068161835, 0.4881873305, -0.8727388672, -0.3683854996, -0.9296731273, -0.9825390578, 0.1860564427,
  0.81256471, 0.5828709909, 0.3196460933, -0.9475370046, 0.9570913859, 0.2897862643, -0.6876655497, -0.7260276109,
  -0.9988770922, -0.047376731, -0.1250179027, 0.992154486, -0.8280133617, 0.560708367, 0.9324863769, -0.3612051451,
  0.6394653183, 0.7688199442, -0.01623847064, -0.9998681473, -0.9955014666, -0.09474613458, -0.81453315, 0.580117012,
  0.4037327978, -0.9148769469, 0.9944263371, 0.1054336766, -0.1624711654, 0.9867132919, -0.9949487814, -0.100383875,
  -0.6995302564, 0.7146029809, 0.5263414922, -0.85027327, -0.5395221479, 0.841971408, 0.6579370318, 0.7530729462,
  0.01426758847, -0.9998982128, -0.6734383991, 0.7392433447, 0.639412098, -0.7688642071, 0.9211571421, 0.3891908523,
  -0.146637214, -0.9891903394, -0.782318098, 0.6228791163, -0.5039610839, -0.8637263605, -0.7743120191, -0.6328039957,
];
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Constant subexpressions of `SingleOpenSimplex2S`'s float arithmetic, rounded once here instead of
 * on every call. Each is the same double passed through the same `toFloat32`, so the values are
 * bit-identical — this removes work, not precision. The inner loop was the single hottest function
 * in a relief tile (docs/PLAN.md §6 round 5).
 */
const G2_F = toFloat32(G2);
const TWO_THIRDS_F = toFloat32(2.0 / 3.0);
const G2_MINUS_1_F = toFloat32(G2 - 1);
const ONE_MINUS_G2_F = toFloat32(1 - G2);
const ONE_MINUS_2G2_F = toFloat32(1 - 2 * G2);
const THREE_G2_MINUS_1_F = toFloat32(3 * G2 - 1);
const THREE_G2_MINUS_2_F = toFloat32(3 * G2 - 2);
const A1_SCALE_F = toFloat32(2 * (1 - 2 * G2) * (1 / G2 - 2));
const A1_OFFSET_F = toFloat32(-2 * (1 - 2 * G2) * (1 - 2 * G2));
const OUTPUT_SCALE_F = toFloat32(18.24196194486065);

/**
 * `FastNoiseLite.SingleOpenSimplex2S(int seed, double x, double y)`. Expects `x`/`y` already
 * frequency-scaled and skewed once by the caller (`FastNoiseLite.GetNoise`'s
 * `case OpenSimplex2: case OpenSimplex2S:` block — see {@link openSimplex2SNoise}), matching the
 * Java method exactly (its own comment: "Skew moved to TransformNoiseCoordinate method").
 */
export function singleOpenSimplex2S(seed: number, x: number, y: number): number {
  let i = fastFloor(x);
  let j = fastFloor(y);
  const xi = toFloat32(x - i);
  const yi = toFloat32(y - j);

  i = Math.imul(i, PRIME_X);
  j = Math.imul(j, PRIME_Y);
  const i1 = (i + PRIME_X) | 0;
  const j1 = (j + PRIME_Y) | 0;

  const t = toFloat32(toFloat32(xi + yi) * G2_F);
  const x0 = toFloat32(xi - t);
  const y0 = toFloat32(yi - t);

  const a0 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x0 * x0)) - toFloat32(y0 * y0));
  let value = toFloat32(toFloat32(toFloat32(a0 * a0) * toFloat32(a0 * a0)) * gradCoord2D(seed, i, j, x0, y0));

  // Java: `(float)(2*(1-2*G2)*(1/G2-2)) * t + ((float)(-2*(1-2*G2)*(1-2*G2)) + a0)` — three
  // separate float operations (the two `(float)`-cast products already narrow once each, then the
  // `B + a0` addition narrows again, then the outer `+`), not one narrowing at the very end.
  const a1Product = toFloat32(A1_SCALE_F * t);
  const a1Offset = toFloat32(A1_OFFSET_F + a0);
  const a1 = toFloat32(a1Product + a1Offset);
  const x1 = toFloat32(x0 - ONE_MINUS_2G2_F);
  const y1 = toFloat32(y0 - ONE_MINUS_2G2_F);
  value = toFloat32(value + toFloat32(toFloat32(toFloat32(a1 * a1) * toFloat32(a1 * a1)) * gradCoord2D(seed, i1, j1, x1, y1)));

  const xmyi = toFloat32(xi - yi);
  if (t > G2) {
    if (toFloat32(xi + xmyi) > 1) {
      const x2 = toFloat32(x0 + THREE_G2_MINUS_2_F);
      const y2 = toFloat32(y0 + THREE_G2_MINUS_1_F);
      const a2 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x2 * x2)) - toFloat32(y2 * y2));
      if (a2 > 0) {
        value = toFloat32(
          value + toFloat32(toFloat32(toFloat32(a2 * a2) * toFloat32(a2 * a2)) * gradCoord2D(seed, (i + (PRIME_X << 1)) | 0, (j + PRIME_Y) | 0, x2, y2)),
        );
      }
    } else {
      const x2 = toFloat32(x0 + G2_F);
      const y2 = toFloat32(y0 + G2_MINUS_1_F);
      const a2 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x2 * x2)) - toFloat32(y2 * y2));
      if (a2 > 0) {
        value = toFloat32(value + toFloat32(toFloat32(toFloat32(a2 * a2) * toFloat32(a2 * a2)) * gradCoord2D(seed, i, (j + PRIME_Y) | 0, x2, y2)));
      }
    }

    if (toFloat32(yi - xmyi) > 1) {
      const x3 = toFloat32(x0 + THREE_G2_MINUS_1_F);
      const y3 = toFloat32(y0 + THREE_G2_MINUS_2_F);
      const a3 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x3 * x3)) - toFloat32(y3 * y3));
      if (a3 > 0) {
        value = toFloat32(
          value + toFloat32(toFloat32(toFloat32(a3 * a3) * toFloat32(a3 * a3)) * gradCoord2D(seed, (i + PRIME_X) | 0, (j + (PRIME_Y << 1)) | 0, x3, y3)),
        );
      }
    } else {
      const x3 = toFloat32(x0 + G2_MINUS_1_F);
      const y3 = toFloat32(y0 + G2_F);
      const a3 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x3 * x3)) - toFloat32(y3 * y3));
      if (a3 > 0) {
        value = toFloat32(value + toFloat32(toFloat32(toFloat32(a3 * a3) * toFloat32(a3 * a3)) * gradCoord2D(seed, (i + PRIME_X) | 0, j, x3, y3)));
      }
    }
  } else {
    if (toFloat32(xi + xmyi) < 0) {
      const x2 = toFloat32(x0 + ONE_MINUS_G2_F);
      const y2 = toFloat32(y0 - G2_F);
      const a2 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x2 * x2)) - toFloat32(y2 * y2));
      if (a2 > 0) {
        value = toFloat32(value + toFloat32(toFloat32(toFloat32(a2 * a2) * toFloat32(a2 * a2)) * gradCoord2D(seed, (i - PRIME_X) | 0, j, x2, y2)));
      }
    } else {
      const x2 = toFloat32(x0 + G2_MINUS_1_F);
      const y2 = toFloat32(y0 + G2_F);
      const a2 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x2 * x2)) - toFloat32(y2 * y2));
      if (a2 > 0) {
        value = toFloat32(value + toFloat32(toFloat32(toFloat32(a2 * a2) * toFloat32(a2 * a2)) * gradCoord2D(seed, (i + PRIME_X) | 0, j, x2, y2)));
      }
    }

    if (yi < xmyi) {
      const x2 = toFloat32(x0 - G2_F);
      const y2 = toFloat32(y0 - G2_MINUS_1_F);
      const a2 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x2 * x2)) - toFloat32(y2 * y2));
      if (a2 > 0) {
        value = toFloat32(value + toFloat32(toFloat32(toFloat32(a2 * a2) * toFloat32(a2 * a2)) * gradCoord2D(seed, i, (j - PRIME_Y) | 0, x2, y2)));
      }
    } else {
      const x2 = toFloat32(x0 + G2_F);
      const y2 = toFloat32(y0 + G2_MINUS_1_F);
      const a2 = toFloat32(toFloat32(TWO_THIRDS_F - toFloat32(x2 * x2)) - toFloat32(y2 * y2));
      if (a2 > 0) {
        value = toFloat32(value + toFloat32(toFloat32(toFloat32(a2 * a2) * toFloat32(a2 * a2)) * gradCoord2D(seed, i, (j + PRIME_Y) | 0, x2, y2)));
      }
    }
  }

  // `18.24196194486065f` is a Java float literal — round it to float32 before multiplying,
  // matching a single-precision `value * 18.24196194486065f` rather than a double multiply
  // rounded once at the end (the two disagree in the last ULP often enough to matter — see
  // `gradCoord2D`'s comment for the same class of bug).
  return toFloat32(value * OUTPUT_SCALE_F);
}

/** `FastNoiseLite.CalculateFractalBounding()` with the library defaults TFC never overrides (`mGain = 0.5`). */
export function calculateFractalBounding(octaves: number): number {
  const gain = 0.5;
  let amp = gain;
  let ampFractal = toFloat32(1.0);
  for (let i = 1; i < octaves; i++) {
    ampFractal = toFloat32(ampFractal + amp);
    amp = toFloat32(amp * gain);
  }
  return toFloat32(1 / ampFractal);
}

const SQRT3 = 1.7320508075688772935274463415059;
const SKEW_F2 = 0.5 * (SQRT3 - 1);

/**
 * `FastNoiseLite.GetNoise(double x, double y)` for `NoiseType.OpenSimplex2S`, restricted to the
 * fractal settings TFC's `OpenSimplex2D` ever configures: `FractalType.FBm` with
 * `mLacunarity = 2.0`, `mGain = 0.5` (both library defaults, never overridden), and `octaves >= 1`.
 * `seed` is the 32-bit int the library was constructed with (`FastNoiseLite.mSeed`).
 *
 * `FastNoiseLite.mFrequency` is a `float` field (`SetFrequency(double f) { mFrequency = (float)
 * f; }`) even though `OpenSimplex2D`'s own `frequency` field accumulates in `double` — every
 * `spread()`/`octaves()` call immediately re-narrows it via `SetFrequency`, so only the *final*
 * accumulated value is ever narrowed (each intermediate narrowing is simply overwritten by the
 * next `SetFrequency` call), which is exactly what a single `Math.fround` here reproduces. Missing
 * this was a real bug caught by `tests/parity/tfc-1.20-climate.parity.test.ts`'s `"noise"` cases.
 */
export function openSimplex2SNoise(seed: number, frequency: number, octaves: number, x: number, z: number): number {
  const f = toFloat32(frequency);
  let sx = x * f;
  let sz = z * f;

  const t = (sx + sz) * SKEW_F2;
  sx += t;
  sz += t;

  if (octaves <= 1) {
    return singleOpenSimplex2S(seed | 0, sx, sz);
  }

  const fractalBounding = calculateFractalBounding(octaves);
  let s = seed | 0;
  let sum = 0;
  let amp = fractalBounding;
  for (let i = 0; i < octaves; i++) {
    const noise = singleOpenSimplex2S(s, sx, sz);
    s = (s + 1) | 0;
    sum = toFloat32(sum + toFloat32(noise * amp));
    sx *= 2.0;
    sz *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

/**
 * `new OpenSimplex2D(long seed)`'s int fold: `(int)(seed ^ (seed >> 32))` — a *signed* (arithmetic)
 * shift. Distinct from {@link longSeedToInt32Unsigned}, which `Cellular2D` uses instead; the two
 * differ for negative seeds and both appear in the region generator's noise field setup, so mixing
 * them up silently reseeds one of the noise fields wrong.
 */
export function longSeedToInt32Signed(seed: bigint): number {
  const canonical = toInt64(seed);
  return Number(BigInt.asIntN(32, canonical ^ (canonical >> 32n)));
}

/**
 * `it.unimi.dsi.fastutil.HashCommon.long2int(long l)`: `(int)(l ^ (l >>> 32))` — an *unsigned*
 * shift. A single well-known, publicly documented one-line utility from fastutil (Apache-2.0), not
 * TFC- or Mojang-specific; used by `Cellular2D`'s constructor (`new Cellular2D(long seed)`).
 */
export function longSeedToInt32Unsigned(seed: bigint): number {
  const canonical = toInt64(seed);
  return Number(BigInt.asIntN(32, canonical ^ unsignedRightShift64(canonical, 32n)));
}
