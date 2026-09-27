import { describe, expect, it } from 'vitest';
import { KOPPEN_CLASSES, classifyKoppen, type KoppenClass } from '../../src/app/koppen';

describe('classifyKoppen', () => {
  it('reaches every class it declares', () => {
    // `subarctic` is returned from two different branches, so twelve names do not guarantee twelve
    // reachable outcomes -- sweep the whole climate domain and check nothing is dead.
    const seen = new Set<KoppenClass>();
    for (let t = -40; t <= 40; t += 0.5) {
      for (let r = 0; r <= 500; r += 5) {
        seen.add(classifyKoppen(t, r));
      }
    }
    expect([...seen].sort()).toEqual([...KOPPEN_CLASSES].sort());
  });

  it('classifies a representative point in each class', () => {
    expect(classifyKoppen(-25, 300)).toBe('arctic');
    expect(classifyKoppen(-18, 200)).toBe('tundra');
    expect(classifyKoppen(-18, 400)).toBe('subarctic');
    expect(classifyKoppen(0, 100)).toBe('cold-desert');
    expect(classifyKoppen(20, 100)).toBe('hot-desert');
    expect(classifyKoppen(0, 200)).toBe('temperate');
    expect(classifyKoppen(15, 200)).toBe('subtropical');
    expect(classifyKoppen(15, 400)).toBe('humid-subtropical');
    expect(classifyKoppen(0, 400)).toBe('humid-oceanic');
    expect(classifyKoppen(-10, 400)).toBe('humid-subarctic');
    expect(classifyKoppen(25, 200)).toBe('tropical-savanna');
    expect(classifyKoppen(25, 400)).toBe('tropical-rainforest');
  });

  it('tests dryness before cold, as the Java does', () => {
    // The ordering trap: a dry, very cold spot is a cold desert, not tundra. Sorting the branches
    // by temperature would read as tidier and answer differently.
    expect(classifyKoppen(-18, 100)).toBe('cold-desert');
    expect(classifyKoppen(-18, 160)).toBe('tundra');
  });

  it('keeps the boundaries strict on the side Java has them', () => {
    // Every threshold is `<` or `>`, never `<=` / `>=`; each pair straddles one constant.
    expect(classifyKoppen(-20, 300)).not.toBe('arctic');
    expect(classifyKoppen(-20.5, 300)).toBe('arctic');
    expect(classifyKoppen(0, 150)).not.toBe('cold-desert');
    expect(classifyKoppen(0, 149)).toBe('cold-desert');
    expect(classifyKoppen(4, 100)).toBe('cold-desert');
    expect(classifyKoppen(4.5, 100)).toBe('hot-desert');
    expect(classifyKoppen(18, 200)).toBe('subtropical');
    expect(classifyKoppen(18.5, 200)).toBe('tropical-savanna');
    expect(classifyKoppen(15, 350)).toBe('subtropical');
    expect(classifyKoppen(15, 351)).toBe('humid-subtropical');
    expect(classifyKoppen(-5, 400)).toBe('humid-subarctic');
    expect(classifyKoppen(-4.5, 400)).toBe('humid-oceanic');
  });
});
