import { describe, test, expect, beforeEach } from "bun:test";
import { HashUtils, HashStringMap } from "../../src/utils/hash.js";

describe("HashUtils", () => {
  describe("hashString", () => {
    test("should hash strings consistently", () => {
      const hash1 = HashUtils.hashString("hello");
      const hash2 = HashUtils.hashString("hello");
      expect(hash1).toBe(hash2);
    });

    test("should produce different hashes for different strings", () => {
      const hash1 = HashUtils.hashString("hello");
      const hash2 = HashUtils.hashString("world");
      expect(hash1).not.toBe(hash2);
    });

    test("should handle empty string", () => {
      const hash = HashUtils.hashString("");
      expect(typeof hash).toBe("number");
      expect(Number.isInteger(hash)).toBe(true);
    });

    test("should handle unicode strings", () => {
      const hash1 = HashUtils.hashString("café");
      const hash2 = HashUtils.hashString("🚀");
      expect(typeof hash1).toBe("number");
      expect(typeof hash2).toBe("number");
    });

    test("should respect seed parameter", () => {
      const hash1 = HashUtils.hashString("test", 12345);
      const hash2 = HashUtils.hashString("test", 54321);
      expect(hash1).not.toBe(hash2);
    });

    test("should return 32-bit numbers", () => {
      const hash = HashUtils.hashString("test");
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
    });
  });

  describe("hashBytes", () => {
    test("should hash byte arrays consistently", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = HashUtils.hashBytes(bytes);
      const hash2 = HashUtils.hashBytes(bytes);
      expect(hash1).toBe(hash2);
    });

    test("should produce different hashes for different byte arrays", () => {
      const bytes1 = new Uint8Array([1, 2, 3]);
      const bytes2 = new Uint8Array([4, 5, 6]);
      const hash1 = HashUtils.hashBytes(bytes1);
      const hash2 = HashUtils.hashBytes(bytes2);
      expect(hash1).not.toBe(hash2);
    });

    test("should handle empty byte array", () => {
      const bytes = new Uint8Array([]);
      const hash = HashUtils.hashBytes(bytes);
      expect(typeof hash).toBe("number");
    });
  });

  describe("hashValue", () => {
    test("should hash various value types", () => {
      const stringHash = HashUtils.hashValue("test");
      const numberHash = HashUtils.hashValue(42);
      const objectHash = HashUtils.hashValue({ foo: "bar" });
      
      expect(typeof stringHash).toBe("number");
      expect(typeof numberHash).toBe("number");
      expect(typeof objectHash).toBe("number");
    });

    test("should handle null and undefined", () => {
      const nullHash = HashUtils.hashValue(null);
      const undefinedHash = HashUtils.hashValue(undefined);
      
      expect(typeof nullHash).toBe("number");
      expect(typeof undefinedHash).toBe("number");
      expect(nullHash).not.toBe(undefinedHash);
    });

    test("should handle arrays", () => {
      const arrayHash = HashUtils.hashValue([1, 2, 3]);
      expect(typeof arrayHash).toBe("number");
    });

    test("should handle dates", () => {
      const date = new Date("2023-01-01");
      const dateHash = HashUtils.hashValue(date);
      expect(typeof dateHash).toBe("number");
    });
  });

  describe("hash64", () => {
    test("should return BigInt", () => {
      const hash = HashUtils.hash64("test");
      expect(typeof hash).toBe("bigint");
    });

    test("should be consistent", () => {
      const hash1 = HashUtils.hash64("test");
      const hash2 = HashUtils.hash64("test");
      expect(hash1).toBe(hash2);
    });

    test("should handle byte arrays", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const hash = HashUtils.hash64(bytes);
      expect(typeof hash).toBe("bigint");
    });
  });

  describe("combineHashes", () => {
    test("should combine multiple hashes", () => {
      const hash1 = HashUtils.hashString("a");
      const hash2 = HashUtils.hashString("b");
      const hash3 = HashUtils.hashString("c");
      
      const combined = HashUtils.combineHashes(hash1, hash2, hash3);
      expect(typeof combined).toBe("number");
      expect(Number.isInteger(combined)).toBe(true);
    });

    test("should produce different results for different combinations", () => {
      const hash1 = HashUtils.hashString("a");
      const hash2 = HashUtils.hashString("b");
      
      const combined1 = HashUtils.combineHashes(hash1, hash2);
      const combined2 = HashUtils.combineHashes(hash2, hash1);
      
      expect(combined1).not.toBe(combined2);
    });

    test("should handle single hash", () => {
      const hash = HashUtils.hashString("test");
      const combined = HashUtils.combineHashes(hash);
      expect(typeof combined).toBe("number");
    });

    test("should handle empty array", () => {
      const combined = HashUtils.combineHashes();
      expect(typeof combined).toBe("number");
    });
  });

  describe("hashNumber", () => {
    test("should hash numbers consistently", () => {
      const hash1 = HashUtils.hashNumber(42.5);
      const hash2 = HashUtils.hashNumber(42.5);
      expect(hash1).toBe(hash2);
    });

    test("should handle integers and floats", () => {
      const intHash = HashUtils.hashNumber(42);
      const floatHash = HashUtils.hashNumber(42.5);
      
      expect(typeof intHash).toBe("number");
      expect(typeof floatHash).toBe("number");
      expect(intHash).not.toBe(floatHash);
    });

    test("should handle special values", () => {
      const infHash = HashUtils.hashNumber(Infinity);
      const negInfHash = HashUtils.hashNumber(-Infinity);
      const zeroHash = HashUtils.hashNumber(0);
      const negZeroHash = HashUtils.hashNumber(-0);
      
      expect(typeof infHash).toBe("number");
      expect(typeof negInfHash).toBe("number");
      expect(typeof zeroHash).toBe("number");
      expect(typeof negZeroHash).toBe("number");
    });
  });

  describe("hashBigInt", () => {
    test("should hash BigInt values", () => {
      const hash1 = HashUtils.hashBigInt(123n);
      const hash2 = HashUtils.hashBigInt(123n);
      expect(hash1).toBe(hash2);
    });

    test("should handle different BigInt values", () => {
      const hash1 = HashUtils.hashBigInt(123n);
      const hash2 = HashUtils.hashBigInt(456n);
      expect(hash1).not.toBe(hash2);
    });

    test("should handle large BigInt values", () => {
      const largeBigInt = BigInt("123456789012345678901234567890");
      const hash = HashUtils.hashBigInt(largeBigInt);
      expect(typeof hash).toBe("number");
    });

    test("should handle negative BigInt values", () => {
      const hash1 = HashUtils.hashBigInt(123n);
      const hash2 = HashUtils.hashBigInt(-123n);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("universalHash", () => {
    test("should handle all primitive types", () => {
      const tests = [
        "string",
        42,
        42.5,
        123n,
        true,
        false,
        null,
        undefined
      ];

      for (const value of tests) {
        const hash = HashUtils.universalHash(value);
        expect(typeof hash).toBe("number");
      }
    });

    test("should handle objects", () => {
      const obj = { foo: "bar", baz: 42 };
      const hash = HashUtils.universalHash(obj);
      expect(typeof hash).toBe("number");
    });

    test("should handle Date objects", () => {
      const date = new Date("2023-01-01");
      const hash = HashUtils.universalHash(date);
      expect(typeof hash).toBe("number");
    });

    test("should handle Uint8Array", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const hash = HashUtils.universalHash(bytes);
      expect(typeof hash).toBe("number");
    });

    test("should be consistent for same values", () => {
      const value = { nested: { data: [1, 2, 3] } };
      const hash1 = HashUtils.universalHash(value);
      const hash2 = HashUtils.universalHash(value);
      expect(hash1).toBe(hash2);
    });
  });

  describe("createKey", () => {
    test("should create string keys from multiple values", () => {
      const key = HashUtils.createKey("user", 123, "active");
      expect(typeof key).toBe("string");
      expect(key).toContain(":");
    });

    test("should be consistent for same inputs", () => {
      const key1 = HashUtils.createKey("a", "b", "c");
      const key2 = HashUtils.createKey("a", "b", "c");
      expect(key1).toBe(key2);
    });

    test("should handle empty inputs", () => {
      const key = HashUtils.createKey();
      expect(typeof key).toBe("string");
    });

    test("should handle single value", () => {
      const key = HashUtils.createKey("single");
      expect(typeof key).toBe("string");
    });
  });
});

describe("HashStringMap", () => {
  let map: HashStringMap;

  beforeEach(() => {
    map = new HashStringMap();
  });

  describe("basic operations", () => {
    test("should find or add strings", () => {
      const index1 = map.findOrAdd("hello");
      const index2 = map.findOrAdd("world");
      const index3 = map.findOrAdd("hello"); // duplicate
      
      expect(index1).toBe(0);
      expect(index2).toBe(1);
      expect(index3).toBe(0); // should return same index
    });

    test("should retrieve strings by index", () => {
      const index1 = map.findOrAdd("hello");
      const index2 = map.findOrAdd("world");
      
      expect(map.getString(index1)).toBe("hello");
      expect(map.getString(index2)).toBe("world");
    });

    test("should return undefined for invalid indices", () => {
      expect(map.getString(999)).toBeUndefined();
      expect(map.getString(-1)).toBeUndefined();
    });

    test("should track size correctly", () => {
      expect(map.size()).toBe(0);
      
      map.findOrAdd("a");
      expect(map.size()).toBe(1);
      
      map.findOrAdd("b");
      expect(map.size()).toBe(2);
      
      map.findOrAdd("a"); // duplicate
      expect(map.size()).toBe(2);
    });

    test("should get all strings", () => {
      map.findOrAdd("hello");
      map.findOrAdd("world");
      map.findOrAdd("test");
      
      const strings = map.getStrings();
      expect(strings).toEqual(["hello", "world", "test"]);
    });
  });

  describe("hash collisions", () => {
    test("should handle hash collisions correctly", () => {
      // This test assumes we might have hash collisions
      // We'll add many strings and verify they're all handled correctly
      const testStrings = [
        "a", "b", "c", "test1", "test2", "longer_string_here",
        "unicode_café", "🚀", "numbers123", "special!@#$%"
      ];
      
      const indices: number[] = [];
      for (const str of testStrings) {
        indices.push(map.findOrAdd(str));
      }
      
      // All indices should be unique
      const uniqueIndices = new Set(indices);
      expect(uniqueIndices.size).toBe(testStrings.length);
      
      // Should be able to retrieve all strings
      for (let i = 0; i < testStrings.length; i++) {
        expect(map.getString(indices[i])).toBe(testStrings[i]);
      }
    });
  });

  describe("edge cases", () => {
    test("should handle empty string", () => {
      const index = map.findOrAdd("");
      expect(index).toBe(0);
      expect(map.getString(index)).toBe("");
    });

    test("should handle very long strings", () => {
      const longString = "x".repeat(10000);
      const index = map.findOrAdd(longString);
      expect(map.getString(index)).toBe(longString);
    });

    test("should handle unicode strings", () => {
      const unicodeStrings = ["café", "🚀", "测试", "عربي"];
      
      for (const str of unicodeStrings) {
        const index = map.findOrAdd(str);
        expect(map.getString(index)).toBe(str);
      }
    });
  });

  describe("statistics", () => {
    beforeEach(() => {
      map.findOrAdd("hello");
      map.findOrAdd("world");
      map.findOrAdd("test");
      map.findOrAdd("hello"); // duplicate
    });

    test("should provide accurate statistics", () => {
      const stats = map.getStats();
      
      expect(stats.uniqueStrings).toBe(3);
      expect(stats.totalLength).toBe("hello".length + "world".length + "test".length);
      expect(stats.hashCollisions).toBeGreaterThanOrEqual(0);
    });

    test("should calculate total length correctly", () => {
      const stats = map.getStats();
      const expectedLength = "hello".length + "world".length + "test".length; // 5 + 5 + 4 = 14
      expect(stats.totalLength).toBe(expectedLength);
    });
  });

  describe("clear operation", () => {
    test("should clear all data", () => {
      map.findOrAdd("hello");
      map.findOrAdd("world");
      
      expect(map.size()).toBe(2);
      
      map.clear();
      
      expect(map.size()).toBe(0);
      expect(map.getStrings()).toEqual([]);
      expect(map.getString(0)).toBeUndefined();
    });

    test("should work correctly after clearing", () => {
      map.findOrAdd("hello");
      map.clear();
      
      const index = map.findOrAdd("world");
      expect(index).toBe(0); // Should start from 0 again
      expect(map.getString(index)).toBe("world");
    });
  });

  describe("seed behavior", () => {
    test("should use custom seed", () => {
      const map1 = new HashStringMap(12345);
      const map2 = new HashStringMap(54321);
      
      const index1 = map1.findOrAdd("test");
      const index2 = map2.findOrAdd("test");
      
      // Both should work correctly regardless of seed
      expect(map1.getString(index1)).toBe("test");
      expect(map2.getString(index2)).toBe("test");
    });
  });
});