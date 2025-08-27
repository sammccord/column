import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import { 
  KeyColumn, 
  KeyColumnReader, 
  KeyColumnUtils,
  createKeyColumn
} from "../../src/columns/key.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import type { TransactionState } from "../../src/types.js";

describe("KeyColumn", () => {
  let column: KeyColumn;

  beforeEach(() => {
    column = createKeyColumn("test_keys");
  });

  describe("basic operations", () => {
    test("should set and get key values", async () => {
      await column.set(0, "key1");
      await column.set(1, "key2");
      await column.set(2, "key3");

      expect(await column.get(0)).toBe("key1");
      expect(await column.get(1)).toBe("key2");
      expect(await column.get(2)).toBe("key3");
      expect(await column.get(3)).toBeUndefined();
    });

    test("should validate string key types", async () => {
      await expect(column.set(0, 123 as any)).rejects.toThrow("Expected string key value");
      await expect(column.set(0, null as any)).rejects.toThrow("Expected string key value");
      await expect(column.set(0, undefined as any)).rejects.toThrow("Expected string key value");
      await expect(column.set(0, {} as any)).rejects.toThrow("Expected string key value");
    });

    test("should enforce uniqueness by default", async () => {
      await column.set(0, "unique_key");
      
      await expect(column.set(1, "unique_key")).rejects.toThrow("Duplicate key: unique_key");
    });

    test("should allow duplicate keys when unique is false", async () => {
      const nonUniqueColumn = createKeyColumn("non_unique", { unique: false });
      
      await nonUniqueColumn.set(0, "duplicate_key");
      await nonUniqueColumn.set(1, "duplicate_key");

      expect(await nonUniqueColumn.get(0)).toBe("duplicate_key");
      expect(await nonUniqueColumn.get(1)).toBe("duplicate_key");
    });

    test("should allow updating same index with same key", async () => {
      await column.set(0, "test_key");
      
      // Should not throw even with unique=true
      await column.set(0, "test_key");
      expect(await column.get(0)).toBe("test_key");
    });

    test("should update key mappings when changing values", async () => {
      await column.set(0, "old_key");
      expect(column.findIndex("old_key")).toBe(0);
      expect(column.hasKey("old_key")).toBe(true);

      await column.set(0, "new_key");
      expect(column.findIndex("old_key")).toBeUndefined();
      expect(column.findIndex("new_key")).toBe(0);
      expect(column.hasKey("old_key")).toBe(false);
      expect(column.hasKey("new_key")).toBe(true);
    });

    test("should track size correctly", async () => {
      expect(column.size()).toBe(0);

      await column.set(0, "key1");
      expect(column.size()).toBe(1);

      await column.set(1, "key2");
      expect(column.size()).toBe(2);

      await column.set(0, "updated_key1"); // Update existing
      expect(column.size()).toBe(2);
    });

    test("should remove keys properly", async () => {
      await column.set(0, "key1");
      await column.set(1, "key2");

      expect(column.hasKey("key1")).toBe(true);
      expect(column.findIndex("key1")).toBe(0);

      await column.remove(0);
      expect(column.hasKey("key1")).toBe(false);
      expect(column.findIndex("key1")).toBeUndefined();
      expect(await column.get(0)).toBeUndefined();
      expect(column.size()).toBe(1);
    });
  });

  describe("key-to-index mapping", () => {
    beforeEach(async () => {
      await column.set(0, "alpha");
      await column.set(5, "beta");
      await column.set(10, "gamma");
      await column.set(15, "delta");
    });

    test("should find index by key", () => {
      expect(column.findIndex("alpha")).toBe(0);
      expect(column.findIndex("beta")).toBe(5);
      expect(column.findIndex("gamma")).toBe(10);
      expect(column.findIndex("delta")).toBe(15);
      expect(column.findIndex("nonexistent")).toBeUndefined();
    });

    test("should get key by index", () => {
      expect(column.getKey(0)).toBe("alpha");
      expect(column.getKey(5)).toBe("beta");
      expect(column.getKey(10)).toBe("gamma");
      expect(column.getKey(15)).toBe("delta");
      expect(column.getKey(99)).toBeUndefined();
    });

    test("should check key existence", () => {
      expect(column.hasKey("alpha")).toBe(true);
      expect(column.hasKey("beta")).toBe(true);
      expect(column.hasKey("nonexistent")).toBe(false);
    });

    test("should get all keys", () => {
      const keys = column.getAllKeys();
      expect(keys).toHaveLength(4);
      expect(keys).toContain("alpha");
      expect(keys).toContain("beta");
      expect(keys).toContain("gamma");
      expect(keys).toContain("delta");
    });

    test("should get all key-index pairs", () => {
      const pairs = column.getAllPairs();
      expect(pairs).toHaveLength(4);
      
      const pairMap = new Map(pairs);
      expect(pairMap.get("alpha")).toBe(0);
      expect(pairMap.get("beta")).toBe(5);
      expect(pairMap.get("gamma")).toBe(10);
      expect(pairMap.get("delta")).toBe(15);
    });
  });

  describe("filtering operations", () => {
    beforeEach(async () => {
      await column.set(0, "user:alice");
      await column.set(1, "user:bob");
      await column.set(2, "admin:charlie");
      await column.set(3, "user:diana");
      await column.set(4, "guest:eve");
    });

    test("should filter by prefix", async () => {
      const userKeys = await column.filterByPrefix("user:");
      
      expect(userKeys.size()).toBe(3);
      expect(userKeys.has(0)).toBe(true); // user:alice
      expect(userKeys.has(1)).toBe(true); // user:bob
      expect(userKeys.has(3)).toBe(true); // user:diana
    });

    test("should filter by suffix", async () => {
      const aliceKeys = await column.filterBySuffix(":alice");
      
      expect(aliceKeys.size()).toBe(1);
      expect(aliceKeys.has(0)).toBe(true); // user:alice
    });

    test("should filter by regex pattern", async () => {
      const pattern = /^(user|admin):/;
      const result = await column.filterByPattern(pattern);
      
      expect(result.size()).toBe(4); // All except guest:eve
      expect(result.has(0)).toBe(true); // user:alice
      expect(result.has(1)).toBe(true); // user:bob
      expect(result.has(2)).toBe(true); // admin:charlie
      expect(result.has(3)).toBe(true); // user:diana
      expect(result.has(4)).toBe(false); // guest:eve
    });

    test("should filter by multiple keys", async () => {
      const targetKeys = ["user:alice", "admin:charlie", "nonexistent"];
      const result = await column.filterByKeys(targetKeys);
      
      expect(result.size()).toBe(2);
      expect(result.has(0)).toBe(true); // user:alice
      expect(result.has(2)).toBe(true); // admin:charlie
    });

    test("should filter with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([0, 2, 4]); // alice, charlie, eve
      const result = await column.filterByPrefix("user:", constraintBitmap);
      
      expect(result.size()).toBe(1);
      expect(result.has(0)).toBe(true); // user:alice (only user: key in constraint)
    });

    test("should return empty results for non-matching filters", async () => {
      const result = await column.filterByPrefix("nonexistent:");
      expect(result.isEmpty()).toBe(true);
    });
  });

  describe("key statistics", () => {
    test("should provide accurate key statistics", async () => {
      await column.set(0, "a");       // length 1
      await column.set(1, "hello");   // length 5
      await column.set(2, "world");   // length 5
      await column.set(3, "test");    // length 4
      await column.set(4, "example"); // length 7

      const stats = column.getKeyStats();
      
      expect(stats.uniqueKeys).toBe(5);
      expect(stats.totalMappings).toBe(5);
      expect(stats.averageKeyLength).toBe((1 + 5 + 5 + 4 + 7) / 5); // 4.4
      expect(stats.loadFactor).toBeGreaterThan(0);
      expect(stats.keyLengthDistribution.min).toBe(1);
      expect(stats.keyLengthDistribution.max).toBe(7);
      expect(stats.keyLengthDistribution.median).toBe(5);
    });

    test("should handle empty column statistics", () => {
      const stats = column.getKeyStats();
      
      expect(stats.uniqueKeys).toBe(0);
      expect(stats.totalMappings).toBe(0);
      expect(stats.averageKeyLength).toBe(0);
      expect(stats.loadFactor).toBe(0);
      expect(stats.keyLengthDistribution.min).toBe(0);
      expect(stats.keyLengthDistribution.max).toBe(0);
      expect(stats.keyLengthDistribution.median).toBe(0);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize key mappings", async () => {
      await column.set(0, "key1");
      await column.set(5, "key2");
      await column.set(10, "key3");

      const serialized = await column.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);

      const newColumn = createKeyColumn("restored");
      await newColumn.deserialize(serialized);

      expect(await newColumn.get(0)).toBe("key1");
      expect(await newColumn.get(5)).toBe("key2");
      expect(await newColumn.get(10)).toBe("key3");
      expect(newColumn.size()).toBe(3);

      // Check key mappings are restored
      expect(newColumn.findIndex("key1")).toBe(0);
      expect(newColumn.findIndex("key2")).toBe(5);
      expect(newColumn.findIndex("key3")).toBe(10);
      expect(newColumn.hasKey("key1")).toBe(true);
    });

    test("should handle unicode keys in serialization", async () => {
      await column.set(0, "キー1");
      await column.set(1, "مفتاح2");
      await column.set(2, "ключ3");

      const serialized = await column.serialize();
      const newColumn = createKeyColumn("restored");
      await newColumn.deserialize(serialized);

      expect(await newColumn.get(0)).toBe("キー1");
      expect(await newColumn.get(1)).toBe("مفتاح2");
      expect(await newColumn.get(2)).toBe("ключ3");
    });

    test("should handle empty column serialization", async () => {
      const serialized = await column.serialize();
      const newColumn = createKeyColumn("restored");
      await newColumn.deserialize(serialized);

      expect(newColumn.size()).toBe(0);
      expect(newColumn.getAllKeys()).toHaveLength(0);
    });

    test("should validate type code on deserialization", async () => {
      await column.set(0, "test");
      const serialized = await column.serialize();

      // Corrupt the type code
      const corrupted = new Uint8Array(serialized);
      corrupted[4] = 255; // Invalid type code

      const newColumn = createKeyColumn("test");
      await expect(newColumn.deserialize(corrupted)).rejects.toThrow("Type code mismatch");
    });
  });

  describe("cloning", () => {
    test("should clone column with key mappings", async () => {
      await column.set(0, "key1");
      await column.set(5, "key2");
      await column.set(10, "key3");

      const cloned = column.clone();

      expect(cloned.getName()).toBe(column.getName());
      expect(cloned.size()).toBe(column.size());
      expect(await cloned.get(0)).toBe("key1");
      expect(await cloned.get(5)).toBe("key2");
      expect(await cloned.get(10)).toBe("key3");

      // Check key mappings are cloned
      expect(cloned.findIndex("key1")).toBe(0);
      expect(cloned.findIndex("key2")).toBe(5);
      expect(cloned.findIndex("key3")).toBe(10);

      // Should be independent
      await cloned.set(15, "key4");
      expect(await column.get(15)).toBeUndefined();
      expect(column.hasKey("key4")).toBe(false);
    });

    test("should preserve uniqueness setting in clone", async () => {
      const nonUniqueColumn = createKeyColumn("non_unique", { unique: false });
      await nonUniqueColumn.set(0, "dup");
      await nonUniqueColumn.set(1, "dup");

      const cloned = nonUniqueColumn.clone();
      
      // Should allow duplicates in clone too
      await cloned.set(2, "dup");
      expect(await cloned.get(2)).toBe("dup");
    });
  });

  describe("integrity validation", () => {
    test("should validate consistent key column", async () => {
      await column.set(0, "key1");
      await column.set(1, "key2");
      await column.set(2, "key3");

      const validation = column.validateIntegrity();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test("should detect integrity issues", async () => {
      await column.set(0, "key1");
      await column.set(1, "key2");

      // Manually corrupt the mappings for testing
      const keyToIndex = (column as any).keyToIndex;
      const indexToKey = (column as any).indexToKey;
      
      // Add inconsistent mapping
      keyToIndex.set("corrupted", 99);
      
      const validation = column.validateIntegrity();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });
});

describe("KeyColumnReader", () => {
  let column: KeyColumn;
  let reader: KeyColumnReader;

  beforeEach(async () => {
    column = createKeyColumn("test");
    reader = new KeyColumnReader(column);

    await column.set(0, "key1");
    await column.set(1, "key2");
  });

  test("should read key values", () => {
    reader.setIndex(0);
    expect(reader.getString()).toBe("key1");
    expect(reader.getKey()).toBe("key1");

    reader.setIndex(1);
    expect(reader.getString()).toBe("key2");
    expect(reader.getKey()).toBe("key2");

    reader.setIndex(99);
    expect(reader.getString()).toBeUndefined();
    expect(reader.getKey()).toBeUndefined();
  });
});

describe("KeyColumnUtils", () => {
  describe("key generation", () => {
    test("should generate unique keys", () => {
      const key1 = KeyColumnUtils.generateUniqueKey();
      const key2 = KeyColumnUtils.generateUniqueKey();
      
      expect(key1).not.toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1.length).toBeGreaterThan(0);
    });

    test("should generate unique keys with prefix", () => {
      const key1 = KeyColumnUtils.generateUniqueKey("user:");
      const key2 = KeyColumnUtils.generateUniqueKey("user:");
      
      expect(key1.startsWith("user:")).toBe(true);
      expect(key2.startsWith("user:")).toBe(true);
      expect(key1).not.toBe(key2);
    });

    test("should generate hash-based keys", () => {
      const obj1 = { id: 1, name: "test" };
      const obj2 = { id: 2, name: "test" };
      
      const key1 = KeyColumnUtils.generateHashKey(obj1);
      const key2 = KeyColumnUtils.generateHashKey(obj2);
      
      expect(typeof key1).toBe('string');
      expect(typeof key2).toBe('string');
      expect(key1).not.toBe(key2);
    });

    test("should generate hash keys with prefix", () => {
      const obj = { id: 1 };
      const key = KeyColumnUtils.generateHashKey(obj, "hash:");
      
      expect(key.startsWith("hash:")).toBe(true);
    });

    test("should generate UUID-like keys", () => {
      const uuid1 = KeyColumnUtils.generateUUIDKey();
      const uuid2 = KeyColumnUtils.generateUUIDKey();
      
      expect(uuid1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(uuid2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe("key validation", () => {
    test("should validate basic keys", () => {
      expect(KeyColumnUtils.validateKey("valid_key")).toEqual({ valid: true });
      expect(KeyColumnUtils.validateKey("")).toEqual({ 
        valid: false, 
        error: "Key cannot be empty" 
      });
    });

    test("should validate key length", () => {
      const result1 = KeyColumnUtils.validateKey("ab", { minLength: 3 });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain("too short");

      const result2 = KeyColumnUtils.validateKey("toolong", { maxLength: 5 });
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain("too long");
    });

    test("should validate key patterns", () => {
      const pattern = /^[a-z]+$/;
      
      expect(KeyColumnUtils.validateKey("validkey", { pattern })).toEqual({ valid: true });
      expect(KeyColumnUtils.validateKey("InvalidKey", { pattern })).toEqual({
        valid: false,
        error: "Key does not match required pattern"
      });
    });

    test("should allow empty keys when configured", () => {
      const result = KeyColumnUtils.validateKey("", { allowEmpty: true });
      expect(result.valid).toBe(true);
    });

    test("should use default validation options", () => {
      const longKey = "x".repeat(1001);
      const result = KeyColumnUtils.validateKey(longKey);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too long");
    });
  });
});

describe("KeyColumn edge cases", () => {
  test("should handle very long keys", async () => {
    const column = createKeyColumn("long_keys");
    const longKey = "x".repeat(1000);
    
    await column.set(0, longKey);
    expect(await column.get(0)).toBe(longKey);
    expect(column.findIndex(longKey)).toBe(0);
  });

  test("should handle keys with special characters", async () => {
    const column = createKeyColumn("special_keys");
    const specialKeys = [
      "key with spaces",
      "key\nwith\nnewlines",
      "key\twith\ttabs",
      "key\"with\"quotes",
      "key\\with\\backslashes",
      "key/with/slashes",
      "key@with@symbols#$%"
    ];

    for (let i = 0; i < specialKeys.length; i++) {
      await column.set(i, specialKeys[i]);
    }

    for (let i = 0; i < specialKeys.length; i++) {
      expect(await column.get(i)).toBe(specialKeys[i]);
      expect(column.findIndex(specialKeys[i])).toBe(i);
    }
  });

  test("should handle sparse key indices", async () => {
    const column = createKeyColumn("sparse");
    
    await column.set(0, "first");
    await column.set(1000, "middle");
    await column.set(100000, "last");

    expect(column.size()).toBe(3);
    expect(column.findIndex("first")).toBe(0);
    expect(column.findIndex("middle")).toBe(1000);
    expect(column.findIndex("last")).toBe(100000);
  });

  test("should handle rapid key updates", async () => {
    const column = createKeyColumn("updates");
    
    for (let i = 0; i < 100; i++) {
      await column.set(0, `key_${i}`);
    }

    expect(await column.get(0)).toBe("key_99");
    expect(column.findIndex("key_99")).toBe(0);
    expect(column.findIndex("key_0")).toBeUndefined();
    expect(column.size()).toBe(1);
  });

  test("should handle large number of unique keys", async () => {
    const column = createKeyColumn("many_keys");
    const keyCount = 1000;

    for (let i = 0; i < keyCount; i++) {
      await column.set(i, `key_${i.toString().padStart(4, '0')}`);
    }

    expect(column.size()).toBe(keyCount);
    expect(column.getAllKeys()).toHaveLength(keyCount);

    // Test some random lookups
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * keyCount);
      const expectedKey = `key_${randomIndex.toString().padStart(4, '0')}`;
      expect(column.findIndex(expectedKey)).toBe(randomIndex);
    }
  });

  test("should maintain performance with prefix filtering on many keys", async () => {
    const column = createKeyColumn("performance");
    
    // Add keys with different prefixes
    for (let i = 0; i < 200; i++) {
      await column.set(i, `user_${i}`);
      await column.set(i + 1000, `admin_${i}`);
      await column.set(i + 2000, `guest_${i}`);
    }

    const userKeys = await column.filterByPrefix("user_");
    const adminKeys = await column.filterByPrefix("admin_");
    const guestKeys = await column.filterByPrefix("guest_");

    expect(userKeys.size()).toBe(200);
    expect(adminKeys.size()).toBe(200);
    expect(guestKeys.size()).toBe(200);
  });
});