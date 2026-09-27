import { describe, expect, it } from 'vitest';
import { blockToChunk, floorDiv, floorMod, tileSpanBlocks } from '../../src/core/coords/coords';

describe('coords', () => {
  it('matches Java floorDiv semantics for negative operands', () => {
    expect(floorDiv(-1, 16)).toBe(-1);
    expect(floorDiv(-16, 16)).toBe(-1);
    expect(floorDiv(-17, 16)).toBe(-2);
  });

  it('matches Java floorMod semantics for negative operands', () => {
    expect(floorMod(-1, 16)).toBe(15);
    expect(floorMod(-16, 16)).toBe(0);
  });

  it('converts blocks to chunks in negative space', () => {
    expect(blockToChunk(-1)).toBe(-1);
    expect(blockToChunk(0)).toBe(0);
    expect(blockToChunk(16)).toBe(1);
  });

  it('scales tile span with zoom', () => {
    expect(tileSpanBlocks(0)).toBe(256);
    expect(tileSpanBlocks(2)).toBe(1024);
  });
});
