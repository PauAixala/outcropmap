import { describe, expect, it } from 'vitest';
import {
  addInt32,
  clamp,
  clamp01,
  floorDiv,
  floorMod,
  imul32,
  lerp,
  rotateLeft64,
  smoothstep,
  toFloat32,
  toInt32,
  toInt64,
  toUint64,
  unsignedRightShift64,
} from '@core/math';

describe('floorDiv / floorMod', () => {
  it('rounds toward negative infinity, unlike JS division/modulo', () => {
    expect(floorDiv(-1, 16)).toBe(-1);
    expect(floorDiv(-16, 16)).toBe(-1);
    expect(floorDiv(-17, 16)).toBe(-2);
    expect(floorDiv(15, 16)).toBe(0);

    expect(floorMod(-1, 16)).toBe(15);
    expect(floorMod(-16, 16)).toBe(0);
    expect(floorMod(15, 16)).toBe(15);
  });
});

describe('toInt32 / imul32 / addInt32', () => {
  it('wraps like a Java int', () => {
    expect(toInt32(0xffffffff)).toBe(-1);
    expect(toInt32(0x100000000)).toBe(0);
    expect(imul32(0x7fffffff, 2)).toBe(-2);
    expect(addInt32(0x7fffffff, 1)).toBe(-0x80000000);
  });
});

describe('toFloat32', () => {
  it('rounds to the nearest float32, same as an implicit Java (float) cast', () => {
    expect(toFloat32(0.1)).not.toBe(0.1);
    expect(toFloat32(0.1)).toBeCloseTo(0.1, 6);
    expect(toFloat32(1)).toBe(1);
  });
});

describe('64-bit long helpers', () => {
  it('toInt64 / toUint64 reinterpret the low 64 bits', () => {
    expect(toInt64(-1n)).toBe(-1n);
    expect(toUint64(-1n)).toBe((1n << 64n) - 1n);
    expect(toInt64((1n << 64n) - 1n)).toBe(-1n);
  });

  it('unsignedRightShift64 mirrors Java >>> on a long', () => {
    expect(unsignedRightShift64(-1n, 60n)).toBe(15n);
    expect(unsignedRightShift64(1n, 0n)).toBe(1n);
  });

  it('rotateLeft64 mirrors Long.rotateLeft', () => {
    expect(rotateLeft64(1n, 1n)).toBe(2n);
    expect(rotateLeft64(1n, 0n)).toBe(1n);
    // Rotating the sign bit (bit 63) left by 1 wraps it back to bit 0.
    expect(rotateLeft64(-9223372036854775808n /* 1n << 63n as int64 */, 1n)).toBe(1n);
    // Rotating left by 64 is a no-op.
    expect(rotateLeft64(123456789n, 64n)).toBe(123456789n);
  });
});

describe('interpolation helpers', () => {
  it('clamp / clamp01 / lerp / smoothstep', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp01(1.5)).toBe(1);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
  });
});
