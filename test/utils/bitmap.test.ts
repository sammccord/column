import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import { BitmapUtils, BitmapPool } from "../../src/utils/bitmap.js";

describe("BitmapUtils", () => {
  describe("create", () => {
    test("should create empty bitmap", () => {
      const bitmap = BitmapUtils.create();
      expect(bitmap).toBeInstanceOf(TypedFastBitSet);
      expect(bitmap.size()).toBe(0);
      expect(bitmap.isEmpty()).toBe(true);
    });

    test("should create bitmap with capacity", () => {
      const bitmap = BitmapUtils.create(1000);
      expect(bitmap).toBeInstanceOf(TypedFastBitSet);
      expect(bitmap.isEmpty()).toBe(true);
    });
  });

  describe("fromIndices", () => {
    test("should create bitmap from array of indices", () => {
      const indices = [1, 3, 5, 7, 9];
      const bitmap = BitmapUtils.fromIndices(indices);
      
      expect(bitmap.size()).toBe(5);
      for (const index of indices) {
        expect(bitmap.has(index)).toBe(true);
      }
      expect(bitmap.has(2)).toBe(false);
      expect(bitmap.has(4)).toBe(false);
    });

    test("should handle empty array", () => {
      const bitmap = BitmapUtils.fromIndices([]);
      expect(bitmap.isEmpty()).toBe(true);
    });

    test("should handle duplicate indices", () => {
      const bitmap = BitmapUtils.fromIndices([1, 2, 2, 3, 3, 3]);
      expect(bitmap.size()).toBe(3);
      expect(bitmap.has(1)).toBe(true);
      expect(bitmap.has(2)).toBe(true);
      expect(bitmap.has(3)).toBe(true);
    });
  });

  describe("fromRange", () => {
    test("should create bitmap from range", () => {
      const bitmap = BitmapUtils.fromRange(5, 10);
      expect(bitmap.size()).toBe(5);
      
      for (let i = 5; i < 10; i++) {
        expect(bitmap.has(i)).toBe(true);
      }
      expect(bitmap.has(4)).toBe(false);
      expect(bitmap.has(10)).toBe(false);
    });

    test("should handle empty range", () => {
      const bitmap = BitmapUtils.fromRange(5, 5);
      expect(bitmap.isEmpty()).toBe(true);
    });

    test("should handle single element range", () => {
      const bitmap = BitmapUtils.fromRange(5, 6);
      expect(bitmap.size()).toBe(1);
      expect(bitmap.has(5)).toBe(true);
    });
  });

  describe("logical operations", () => {
    let bitmapA: TypedFastBitSet;
    let bitmapB: TypedFastBitSet;

    beforeEach(() => {
      bitmapA = BitmapUtils.fromIndices([1, 2, 3, 4, 5]);
      bitmapB = BitmapUtils.fromIndices([3, 4, 5, 6, 7]);
    });

    test("and operation", () => {
      const result = BitmapUtils.and(bitmapA, bitmapB);
      expect(result.size()).toBe(3);
      expect(result.has(3)).toBe(true);
      expect(result.has(4)).toBe(true);
      expect(result.has(5)).toBe(true);
      expect(result.has(1)).toBe(false);
      expect(result.has(7)).toBe(false);
    });

    test("or operation", () => {
      const result = BitmapUtils.or(bitmapA, bitmapB);
      expect(result.size()).toBe(7);
      for (let i = 1; i <= 7; i++) {
        expect(result.has(i)).toBe(true);
      }
    });

    test("andNot operation", () => {
      const result = BitmapUtils.andNot(bitmapA, bitmapB);
      expect(result.size()).toBe(2);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true);
      expect(result.has(3)).toBe(false);
      expect(result.has(4)).toBe(false);
      expect(result.has(5)).toBe(false);
    });

    test("intersects", () => {
      expect(BitmapUtils.intersects(bitmapA, bitmapB)).toBe(true);
      
      const bitmapC = BitmapUtils.fromIndices([10, 11, 12]);
      expect(BitmapUtils.intersects(bitmapA, bitmapC)).toBe(false);
    });
  });

  describe("utility functions", () => {
    let bitmap: TypedFastBitSet;

    beforeEach(() => {
      bitmap = BitmapUtils.fromIndices([1, 3, 5, 7, 9]);
    });

    test("count", () => {
      expect(BitmapUtils.count(bitmap)).toBe(5);
      
      const emptyBitmap = new TypedFastBitSet();
      expect(BitmapUtils.count(emptyBitmap)).toBe(0);
    });

    test("isEmpty", () => {
      expect(BitmapUtils.isEmpty(bitmap)).toBe(false);
      
      const emptyBitmap = new TypedFastBitSet();
      expect(BitmapUtils.isEmpty(emptyBitmap)).toBe(true);
    });

    test("range iteration", () => {
      const collected: number[] = [];
      BitmapUtils.range(bitmap, (index) => {
        collected.push(index);
      });
      
      expect(collected).toEqual([1, 3, 5, 7, 9]);
    });

    test("range iteration with early termination", () => {
      const collected: number[] = [];
      BitmapUtils.range(bitmap, (index) => {
        collected.push(index);
        return index < 5; // Stop after 5
      });
      
      expect(collected).toEqual([1, 3, 5]);
    });

    test("toArray", () => {
      const array = BitmapUtils.toArray(bitmap);
      expect(array).toEqual([1, 3, 5, 7, 9]);
    });
  });

  describe("numeric aggregations", () => {
    let bitmap: TypedFastBitSet;
    let data: number[];

    beforeEach(() => {
      bitmap = BitmapUtils.fromIndices([1, 3, 5]);
      data = [10, 20, 30, 40, 50, 60]; // indices 1,3,5 = values 20,40,60
    });

    test("sum for regular numbers", () => {
      const result = BitmapUtils.sum(bitmap, data, 'int32');
      expect(result).toBe(120); // 20 + 40 + 60
    });

    test("sum for empty bitmap", () => {
      const emptyBitmap = new TypedFastBitSet();
      const result = BitmapUtils.sum(emptyBitmap, data, 'int32');
      expect(result).toBe(0);
    });

    test("sum for bigint type", () => {
      const bigintData = [10n, 20n, 30n, 40n, 50n, 60n];
      const result = BitmapUtils.sum(bitmap, bigintData, 'int64');
      expect(result).toBe(120n);
    });

    test("min operation", () => {
      const result = BitmapUtils.min(bitmap, data, 'int32');
      expect(result).toBe(20);
    });

    test("min with empty bitmap", () => {
      const emptyBitmap = new TypedFastBitSet();
      const result = BitmapUtils.min(emptyBitmap, data, 'int32');
      expect(result).toBeUndefined();
    });

    test("max operation", () => {
      const result = BitmapUtils.max(bitmap, data, 'int32');
      expect(result).toBe(60);
    });

    test("max with empty bitmap", () => {
      const emptyBitmap = new TypedFastBitSet();
      const result = BitmapUtils.max(emptyBitmap, data, 'int32');
      expect(result).toBeUndefined();
    });

    test("avg operation", () => {
      const result = BitmapUtils.avg(bitmap, data, 'int32');
      expect(result).toBe(40); // (20 + 40 + 60) / 3
    });

    test("avg with empty bitmap", () => {
      const emptyBitmap = new TypedFastBitSet();
      const result = BitmapUtils.avg(emptyBitmap, data, 'int32');
      expect(result).toBe(0);
    });
  });

  describe("filter", () => {
    test("should filter based on predicate", () => {
      const bitmap = BitmapUtils.fromIndices([0, 1, 2, 3, 4]);
      const data = [10, 15, 20, 25, 30];
      
      const result = BitmapUtils.filter(bitmap, data, (value) => value >= 20);
      
      expect(result.size()).toBe(3);
      expect(result.has(2)).toBe(true); // value 20
      expect(result.has(3)).toBe(true); // value 25
      expect(result.has(4)).toBe(true); // value 30
      expect(result.has(0)).toBe(false); // value 10
      expect(result.has(1)).toBe(false); // value 15
    });

    test("should handle undefined values", () => {
      const bitmap = BitmapUtils.fromIndices([0, 1, 2, 3]);
      const data = [10, undefined, 20, undefined];
      
      const result = BitmapUtils.filter(bitmap, data, (value) => value !== undefined);
      
      expect(result.size()).toBe(2);
      expect(result.has(0)).toBe(true);
      expect(result.has(2)).toBe(true);
      expect(result.has(1)).toBe(false);
      expect(result.has(3)).toBe(false);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize bitmap", () => {
      const original = BitmapUtils.fromIndices([1, 5, 10, 15, 100]);
      const serialized = BitmapUtils.serialize(original);
      const deserialized = BitmapUtils.deserialize(serialized);
      
      expect(deserialized.size()).toBe(original.size());
      expect(BitmapUtils.toArray(deserialized)).toEqual(BitmapUtils.toArray(original));
    });

    test("should handle empty bitmap serialization", () => {
      const original = new TypedFastBitSet();
      const serialized = BitmapUtils.serialize(original);
      const deserialized = BitmapUtils.deserialize(serialized);
      
      expect(deserialized.isEmpty()).toBe(true);
    });

    test("serialized data should be Uint8Array", () => {
      const bitmap = BitmapUtils.fromIndices([1, 2, 3]);
      const serialized = BitmapUtils.serialize(bitmap);
      
      expect(serialized).toBeInstanceOf(Uint8Array);
      expect(serialized.length).toBeGreaterThan(0);
    });
  });
});

describe("BitmapPool", () => {
  beforeEach(() => {
    BitmapPool.clear();
  });

  test("should acquire and release bitmaps", () => {
    const bitmap = BitmapPool.acquire();
    expect(bitmap).toBeInstanceOf(TypedFastBitSet);
    expect(bitmap.isEmpty()).toBe(true);
    
    bitmap.add(1);
    bitmap.add(2);
    bitmap.add(3);
    
    BitmapPool.release(bitmap);
    expect(bitmap.isEmpty()).toBe(true); // Should be cleaned on release
  });

  test("should reuse bitmaps from pool", () => {
    const bitmap1 = BitmapPool.acquire();
    BitmapPool.release(bitmap1);
    
    const bitmap2 = BitmapPool.acquire();
    // Note: We can't guarantee they're the same object due to implementation details,
    // but we can test that the pool is working by ensuring we get clean bitmaps
    expect(bitmap2.isEmpty()).toBe(true);
  });

  test("should handle different capacities", () => {
    const bitmap1 = BitmapPool.acquire(512);
    const bitmap2 = BitmapPool.acquire(1024);
    
    expect(bitmap1).toBeInstanceOf(TypedFastBitSet);
    expect(bitmap2).toBeInstanceOf(TypedFastBitSet);
    
    BitmapPool.release(bitmap1, 512);
    BitmapPool.release(bitmap2, 1024);
  });

  test("should clear all pools", () => {
    const bitmap1 = BitmapPool.acquire();
    const bitmap2 = BitmapPool.acquire(1024);
    
    BitmapPool.release(bitmap1);
    BitmapPool.release(bitmap2, 1024);
    
    BitmapPool.clear();
    
    // After clearing, should still be able to acquire new bitmaps
    const bitmap3 = BitmapPool.acquire();
    expect(bitmap3).toBeInstanceOf(TypedFastBitSet);
  });

  test("should not pool dirty bitmaps", () => {
    const bitmap = BitmapPool.acquire();
    bitmap.add(1);
    bitmap.add(2);
    
    // Should not pool a bitmap that still has bits set
    BitmapPool.release(bitmap);
    
    const newBitmap = BitmapPool.acquire();
    expect(newBitmap.isEmpty()).toBe(true);
  });
});