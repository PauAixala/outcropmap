/**
 * Evaluates the height expressions extracted from `TFGBiomes.java`.
 *
 * TFG gives each of its 109 biomes a height expression, and 51 of them nest — a TFG landform
 * wrapping a TFC base, sometimes two deep:
 *
 * ```java
 * seed -> TFGBiomeNoise.fenglin(seed, BiomeNoise.hills(seed, 4, 8), 40)
 * seed -> TFGNoiseHelpers.max(TFGBiomeNoise.bowlDolines(seed, BiomeNoise.hills(seed, 22, 32), 16),
 *                             BiomeNoise.canyons(seed, 0, 52).spread(1.5))
 * ```
 *
 * **Why evaluate rather than hand-write a table of 109 factories.** A hand table is 109 chances to
 * put a biome on the wrong landform, and every one of those mistakes produces terrain that still
 * looks like terrain. It would also rot: re-extracting after a TFG update would leave the table
 * silently describing the old world. Reading the extracted expression instead means the port tracks
 * the source, and anything it cannot evaluate is reported rather than guessed at.
 *
 * The grammar is tiny and closed, which is what makes this safe rather than clever:
 *
 * ```
 * expression := 'Class::method' | 'seed ->' call
 * call       := Class '.' method '(' args ')' chain*
 * chain      := '.' ('add' | 'spread') '(' args ')'
 * arg        := number | 'seed' | call
 * ```
 *
 * Anything outside it throws, and the caller treats that biome as having no height — see
 * `./surface-height.ts` for why a missing factory must not be approximated.
 */
import type { Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';
import { NoiseChain, chain } from '../noise/noise-chain';

/** A function in the registry: it takes the seed and the already-evaluated arguments. */
export type HeightFunction = (seed: bigint, args: readonly unknown[]) => NoiseChain;

export type HeightRegistry = Readonly<Record<string, HeightFunction>>;

type Node =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'seed' }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly args: readonly Node[];
      readonly chain: readonly { readonly method: string; readonly args: readonly Node[] }[];
    };

/** Splits `a, b(c, d), e` on top-level commas only. */
function splitArgs(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail !== '' || parts.length > 0) parts.push(tail);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Index of the ')' matching the '(' at `open`. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced parentheses in ${text}`);
}

function parseNode(raw: string): Node {
  const text = raw.trim();

  if (text === 'seed') return { kind: 'seed' };

  // A Java numeric literal, possibly with an f/d suffix.
  if (/^-?\d+(\.\d+)?[fFdDlL]?$/.test(text)) {
    return { kind: 'number', value: Number(text.replace(/[fFdDlL]$/, '')) };
  }

  const open = text.indexOf('(');
  if (open === -1) throw new Error(`not a call: ${text}`);
  const head = text.slice(0, open).trim();
  const name = head.includes('.') ? (head.split('.').pop() ?? head) : head;
  const close = matchParen(text, open);
  const args = splitArgs(text.slice(open + 1, close)).map(parseNode);

  // Trailing `.add(...)` / `.spread(...)` applied to the call's result.
  const chainCalls: { method: string; args: Node[] }[] = [];
  let rest = text.slice(close + 1).trim();
  while (rest.startsWith('.')) {
    const chainOpen = rest.indexOf('(');
    if (chainOpen === -1) throw new Error(`chained call without arguments: ${rest}`);
    const method = rest.slice(1, chainOpen).trim();
    const chainClose = matchParen(rest, chainOpen);
    chainCalls.push({
      method,
      args: splitArgs(rest.slice(chainOpen + 1, chainClose)).map(parseNode),
    });
    rest = rest.slice(chainClose + 1).trim();
  }
  if (rest !== '') throw new Error(`trailing text after call: ${rest}`);

  return { kind: 'call', name, args, chain: chainCalls };
}

/** Parses one extracted `.heightmap(...)` expression. Throws if it is outside the grammar. */
export function parseHeightExpression(expression: string): Node {
  const arrow = expression.indexOf('->');
  if (arrow !== -1) return parseNode(expression.slice(arrow + 2));

  // Method reference: `BiomeNoise::lowlands` is `seed -> BiomeNoise.lowlands(seed)`.
  const reference = expression.match(/^(\w+)::(\w+)$/);
  if (reference) {
    return { kind: 'call', name: reference[2] ?? '', args: [{ kind: 'seed' }], chain: [] };
  }
  throw new Error(`unrecognised height expression: ${expression}`);
}

function evaluateNode(node: Node, seed: bigint, registry: HeightRegistry): unknown {
  if (node.kind === 'number') return node.value;
  if (node.kind === 'seed') return seed;

  const fn = registry[node.name];
  if (!fn) throw new Error(`no implementation registered for ${node.name}`);

  // The leading `seed` argument is passed separately, as every factory takes it.
  const args = node.args
    .filter((arg) => arg.kind !== 'seed')
    .map((arg) => evaluateNode(arg, seed, registry));

  let result = fn(seed, args);
  for (const call of node.chain) {
    const chainArgs = call.args.map((arg) => evaluateNode(arg, seed, registry));
    if (call.method === 'spread') {
      result = result.spread(chainArgs[0] as number);
    } else if (call.method === 'add') {
      const operand = chainArgs[0];
      result = result.add(operand instanceof NoiseChain ? operand : (operand as Noise2D));
    } else {
      throw new Error(`unsupported chained method .${call.method}()`);
    }
  }
  return result;
}

/**
 * Builds the height field for one extracted expression.
 *
 * Throws rather than returning a fallback: a biome whose expression cannot be evaluated has no
 * height, and pretending otherwise is what this whole file exists to avoid.
 */
export function evaluateHeightExpression(
  expression: string,
  seed: bigint,
  registry: HeightRegistry,
): Noise2D {
  const result = evaluateNode(parseHeightExpression(expression), seed, registry);
  if (result instanceof NoiseChain) return result.fn;
  if (typeof result === 'function') return result as Noise2D;
  throw new Error(`expression did not evaluate to a noise field: ${expression}`);
}

export { chain };
