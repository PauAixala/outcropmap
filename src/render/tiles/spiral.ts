/**
 * Deterministic clockwise tile-request ordering. Pau's words (docs/FEEDBACK.md): "para recargar
 * empieza por el chunk en el centro de la pantalla y en espiral en sentido horario, ahora mismo
 * parece aleatorio" -- `TileManager.ensureVisible` used to sort wanted tiles by distance to the
 * viewport centre, which leaves every tile at the same distance in whatever order they happened
 * to be pushed (row-major, since `Array.prototype.sort` is stable) -- to the eye that reads as
 * arbitrary among a ring of equidistant tiles. This produces one explicit, tested order instead.
 */

export interface TileOffset {
  readonly tx: number;
  readonly tz: number;
}

/**
 * Every integer offset `(tx, tz)` with Chebyshev distance `<= maxRadius` from `(0, 0)`, in a
 * clockwise square spiral starting at the origin: the centre tile, then each ring outward in
 * clockwise order starting due east. "Clockwise" here matches how it reads on screen: `+tx` is
 * east/right and `+tz` is south/down (`blockToScreen`, `src/core/coords/coords.ts`), so walking
 * east, then south, then west, then north -- the order this function emits -- is clockwise as
 * drawn, the same way a clock face reads 3, 6, 9, 12.
 *
 * A plain function of `maxRadius`, not a class or an iterator over live tile state: the same
 * `maxRadius` always produces the exact same array, independent of cache contents or call order,
 * so `TileManager.ensureVisible` (or a test) can rely on it being stable.
 */
export function spiralOffsets(maxRadius: number): TileOffset[] {
  const radius = Math.max(0, Math.floor(maxRadius));
  const offsets: TileOffset[] = [{ tx: 0, tz: 0 }];
  if (radius === 0) return offsets;

  // Clockwise on a y-down grid: east, south, west, north (see this function's doc comment).
  const directions: readonly TileOffset[] = [
    { tx: 1, tz: 0 },
    { tx: 0, tz: 1 },
    { tx: -1, tz: 0 },
    { tx: 0, tz: -1 },
  ];

  let tx = 0;
  let tz = 0;
  let stepLength = 1;
  let dirIndex = 0;
  // The classic square-spiral walk: two legs at each step length (it takes two turns to widen the
  // square by one on each side), then the step length grows by one. Running it out to
  // `2 * radius + 1` guarantees every offset up to Chebyshev distance `radius` has been emitted at
  // least once (the last ring needs a leg that long to close) -- see the module test for the
  // worked example. Anything generated beyond `radius` is dropped by the filter below.
  while (stepLength <= 2 * radius + 1) {
    for (let leg = 0; leg < 2; leg++) {
      const dir = directions[dirIndex % directions.length]!;
      for (let step = 0; step < stepLength; step++) {
        tx += dir.tx;
        tz += dir.tz;
        offsets.push({ tx, tz });
      }
      dirIndex++;
    }
    stepLength++;
  }

  return offsets.filter((o) => Math.max(Math.abs(o.tx), Math.abs(o.tz)) <= radius);
}
