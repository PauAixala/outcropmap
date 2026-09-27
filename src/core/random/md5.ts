/** RFC 1321 MD5, used only by Minecraft 1.20.1 RandomSupport.seedFromHashOf.
 * This is a deterministic seed hash, not a security primitive. Browser Web Crypto does not
 * expose MD5; keeping this synchronous also lets the generator run unchanged in workers.
 */
export function md5(text: string): Uint8Array {
  const input = new TextEncoder().encode(text);
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setBigUint64(bytes.length - 8, BigInt(input.length) * 8n, true);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    let a = h0, b = h1, c = h2, d = h3;
    for (let i = 0; i < 64; i++) {
      let f: number, word: number;
      if (i < 16) { f = (b & c) | (~b & d); word = i; }
      else if (i < 32) { f = (d & b) | (~d & c); word = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; word = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); word = (7 * i) % 16; }
      const sum = (a + f + CONSTANTS[i]! + view.getUint32(offset + 4 * word, true)) | 0;
      const shift = SHIFTS[(i >> 4) * 4 + i % 4]!;
      a = d; d = c; c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
  }
  const output = new Uint8Array(16);
  const digest = new DataView(output.buffer);
  [h0, h1, h2, h3].forEach((value, i) => digest.setInt32(i * 4, value, true));
  return output;
}

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const CONSTANTS = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
