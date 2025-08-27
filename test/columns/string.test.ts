import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import {
  StringColumn,
  EnumColumn,
  StringColumnReader,
  EnumColumnReader,
  StringColumnAccessor,
  EnumColumnAccessor,
  createStringColumn,
  createEnumColumn
} from "../../src/columns/string.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import type { TransactionState } from "../../src/types.js";

describe("StringColumn", () => {
  let column: StringColumn;

  beforeEach(() => {
    column = createStringColumn("test_string");
  });

  describe("basic operations", () => {
    test("should set and get string values", async () => {
      await column.set(0, "hello");
      await column.set(1, "world");
      await column.set(2, "");

      expect(await column.get(0)).toBe("hello");
      expect(await column.get(1)).toBe("world");
      expect(await column.get(2)).toBe("");
      expect(await column.get(3)).toBeUndefined();
    });

    test("should validate string types", async () => {
      await expect(column.set(0, 123 as any)).rejects.toThrow("Expected string value");
      await expect(column.set(0, null as any)).rejects.toThrow("Expected string value");
      await expect(column.set(0, undefined as any)).rejects.toThrow("Expected string value");
    });

    test("should handle unicode strings", async () => {
      await column.set(0, "café");
      await column.set(1, "🚀");
      await column.set(2, "测试");
      await column.set(3, "عربي");

      expect(await column.get(0)).toBe("café");
      expect(await column.get(1)).toBe("🚀");
      expect(await column.get(2)).toBe("测试");
      expect(await column.get(3)).toBe("عربي");
    });

    test("should handle very long strings", async () => {
      const longString = "x".repeat(10000);
      await column.set(0, longString);

      expect(await column.get(0)).toBe(longString);
    });
  });

  describe("string filtering", () => {
    beforeEach(async () => {
      await column.set(0, "apple");
      await column.set(1, "banana");
      await column.set(2, "cherry");
      await column.set(3, "date");
      await column.set(4, "elderberry");
    });

    test("should filter by prefix", async () => {
      const result = await column.filterByPrefix("b");

      expect(result.size()).toBe(1);
      expect(result.has(1)).toBe(true); // "banana"
    });

    test("should filter by suffix", async () => {
      const result = await column.filterBySuffix("e");

      expect(result.size()).toBe(2);
      expect(result.has(0)).toBe(true); // "apple"
      expect(result.has(3)).toBe(true); // "date"
    });

    test("should filter by substring", async () => {
      const result = await column.filterBySubstring("err");

      expect(result.size()).toBe(2);
      expect(result.has(2)).toBe(true); // "cherry"
      expect(result.has(4)).toBe(true); // "elderberry"
    });

    test("should filter by regex", async () => {
      const result = await column.filterByRegex(/^[aeiou]/); // starts with vowel

      expect(result.size()).toBe(2);
      expect(result.has(0)).toBe(true); // "apple"
      expect(result.has(4)).toBe(true); // "elderberry"
    });

    test("should filter with empty results", async () => {
      const result = await column.filterByPrefix("xyz");
      expect(result.isEmpty()).toBe(true);
    });

    test("should filter with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([0, 2, 4]);
      const result = await column.filterByPrefix("a", constraintBitmap);

      expect(result.size()).toBe(1);
      expect(result.has(0)).toBe(true); // "apple" - only from constraint set
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize", async () => {
      await column.set(0, "hello");
      await column.set(5, "world");
      await column.set(10, "test with spaces");
      await column.set(15, "unicode: 🌟");

      const serialized = await column.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);

      const newColumn = createStringColumn("restored");
      await newColumn.deserialize(serialized);

      expect(await newColumn.get(0)).toBe("hello");
      expect(await newColumn.get(5)).toBe("world");
      expect(await newColumn.get(10)).toBe("test with spaces");
      expect(await newColumn.get(15)).toBe("unicode: 🌟");
      expect(newColumn.size()).toBe(4);
    });

    test("should handle empty strings in serialization", async () => {
      await column.set(0, "");
      await column.set(1, "not empty");

      const serialized = await column.serialize();
      const newColumn = createStringColumn("restored");
      await newColumn.deserialize(serialized);

      expect(await newColumn.get(0)).toBe("");
      expect(await newColumn.get(1)).toBe("not empty");
    });
  });

  describe("cloning", () => {
    test("should clone correctly", async () => {
      await column.set(0, "original");
      await column.set(1, "data");

      const cloned = column.clone();

      expect(cloned.getName()).toBe(column.getName());
      expect(await cloned.get(0)).toBe("original");
      expect(await cloned.get(1)).toBe("data");

      // Should be independent
      await cloned.set(2, "new");
      expect(await column.get(2)).toBeUndefined();
    });
  });
});

describe("EnumColumn", () => {
  let column: EnumColumn;

  beforeEach(() => {
    column = createEnumColumn("test_enum");
  });

  describe("string deduplication", () => {
    test("should deduplicate strings", async () => {
      await column.setString(0, "apple");
      await column.setString(1, "banana");
      await column.setString(2, "apple"); // duplicate
      await column.setString(3, "banana"); // duplicate
      await column.setString(4, "cherry");

      expect(await column.getString(0)).toBe("apple");
      expect(await column.getString(1)).toBe("banana");
      expect(await column.getString(2)).toBe("apple");
      expect(await column.getString(3)).toBe("banana");
      expect(await column.getString(4)).toBe("cherry");

      const uniqueValues = column.getUniqueValues();
      expect(uniqueValues.length).toBe(3);
      expect(uniqueValues).toContain("apple");
      expect(uniqueValues).toContain("banana");
      expect(uniqueValues).toContain("cherry");
    });

    test("should handle empty strings", async () => {
      await column.setString(0, "");
      await column.setString(1, "not empty");
      await column.setString(2, ""); // duplicate empty

      expect(await column.getString(0)).toBe("");
      expect(await column.getString(1)).toBe("not empty");
      expect(await column.getString(2)).toBe("");

      const uniqueValues = column.getUniqueValues();
      expect(uniqueValues.length).toBe(2);
      expect(uniqueValues).toContain("");
      expect(uniqueValues).toContain("not empty");
    });

    test("should provide deduplication statistics", async () => {
      await column.setString(0, "apple");
      await column.setString(1, "apple");
      await column.setString(2, "banana");
      await column.setString(3, "apple");

      const stats = column.getDeduplicationStats();
      expect(stats.uniqueStrings).toBe(2); // "apple", "banana"
      expect(stats.totalInstances).toBe(4);
      expect(stats.compressionRatio).toBe(0.5); // 2/4
      expect(stats.memoryStats.uniqueStrings).toBe(2);
    });
  });

  describe("filtering", () => {
    beforeEach(async () => {
      await column.setString(0, "apple");
      await column.setString(1, "banana");
      await column.setString(2, "apple"); // duplicate
      await column.setString(3, "cherry");
    });

    test("should filter by exact value", async () => {
      const result = await column.filterByValue("apple");

      expect(result.size()).toBe(2);
      expect(result.has(0)).toBe(true);
      expect(result.has(2)).toBe(true); // duplicate apple
    });

    test("should filter with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([1, 2, 3]);
      const result = await column.filterByValue("apple", constraintBitmap);

      expect(result.size()).toBe(1);
      expect(result.has(2)).toBe(true); // only the apple at index 2
      expect(result.has(0)).toBe(false); // apple at index 0 not in constraint
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize with deduplication", async () => {
      await column.setString(0, "apple");
      await column.setString(1, "banana");
      await column.setString(2, "apple");
      await column.setString(3, "cherry");
      await column.setString(4, "apple");

      const serialized = await column.serialize();
      const newColumn = createEnumColumn("restored");
      await newColumn.deserialize(serialized);

      expect(await newColumn.getString(0)).toBe("apple");
      expect(await newColumn.getString(1)).toBe("banana");
      expect(await newColumn.getString(2)).toBe("apple");
      expect(await newColumn.getString(3)).toBe("cherry");
      expect(await newColumn.getString(4)).toBe("apple");

      const uniqueValues = newColumn.getUniqueValues();
      expect(uniqueValues.length).toBe(3);
      expect(uniqueValues).toContain("apple");
      expect(uniqueValues).toContain("banana");
      expect(uniqueValues).toContain("cherry");
    });
  });

  describe("memory efficiency", () => {
    test("should be more memory efficient than regular string column for repeated values", async () => {
      const repeatedString = "this_is_a_long_repeated_string_value";

      // Add the same string many times
      for (let i = 0; i < 1000; i++) {
        await column.setString(i, repeatedString);
      }

      expect(column.size()).toBe(1000);

      const uniqueValues = column.getUniqueValues();
      expect(uniqueValues.length).toBe(1);
      expect(uniqueValues[0]).toBe(repeatedString);

      const stats = column.getDeduplicationStats();
      expect(stats.compressionRatio).toBe(0.001); // 1/1000
    });
  });

  describe("cloning", () => {
    test("should clone with deduplication intact", async () => {
      await column.setString(0, "apple");
      await column.setString(1, "banana");
      await column.setString(2, "apple");

      const cloned = column.clone();

      expect(await cloned.getString(0)).toBe("apple");
      expect(await cloned.getString(1)).toBe("banana");
      expect(await cloned.getString(2)).toBe("apple");

      const uniqueValues = cloned.getUniqueValues();
      expect(uniqueValues.length).toBe(2);
    });
  });
});

describe("StringColumnReader", () => {
  let column: StringColumn;
  let reader: StringColumnReader;

  beforeEach(async () => {
    column = createStringColumn("test");
    reader = new StringColumnReader(column);

    await column.set(0, "hello");
    await column.set(1, "world");
  });

  test("should read string values", () => {
    reader.setIndex(0);
    expect(reader.getString()).toBe("hello");

    reader.setIndex(1);
    expect(reader.getString()).toBe("world");

    reader.setIndex(99);
    expect(reader.getString()).toBeUndefined();
  });
});

describe("EnumColumnReader", () => {
  let column: EnumColumn;
  let reader: EnumColumnReader;

  beforeEach(async () => {
    column = createEnumColumn("test");
    reader = new EnumColumnReader(column);

    await column.setString(0, "apple");
    await column.setString(1, "banana");
  });

  test("should read enum string values", () => {
    reader.setIndex(0);
    expect(reader.getString()).toBe("apple");

    reader.setIndex(1);
    expect(reader.getString()).toBe("banana");

    reader.setIndex(99);
    expect(reader.getString()).toBeUndefined();
  });
});

describe("StringColumnAccessor", () => {
  let column: StringColumn;
  let accessor: StringColumnAccessor;
  let txnState: TransactionState;

  beforeEach(async () => {
    column = createStringColumn("test");
    await column.set(0, "hello");
    await column.set(1, "world");

    txnState = {
      cursor: 0,
      setup: false,
      index: new TypedFastBitSet(),
      dirty: new TypedFastBitSet(),
      columns: new Map()
    };

    accessor = new StringColumnAccessor(column, txnState);
  });

  test("should get current value", () => {
    txnState.cursor = 0;
    expect(accessor.get()).toBe("hello");

    txnState.cursor = 1;
    expect(accessor.get()).toBe("world");

    txnState.cursor = 99;
    expect(accessor.get()).toBeUndefined();
  });

  test("should provide column name", () => {
    expect(accessor.name()).toBe("test");
  });
});

describe("EnumColumnAccessor", () => {
  let column: EnumColumn;
  let accessor: EnumColumnAccessor;
  let txnState: TransactionState;

  beforeEach(async () => {
    column = createEnumColumn("test");
    await column.setString(0, "apple");
    await column.setString(1, "banana");

    txnState = {
      cursor: 0,
      setup: false,
      index: new TypedFastBitSet(),
      dirty: new TypedFastBitSet(),
      columns: new Map()
    };

    accessor = new EnumColumnAccessor(column, txnState);
  });

  test("should get current enum value", () => {
    txnState.cursor = 0;
    expect(accessor.get()).toBe("apple");

    txnState.cursor = 1;
    expect(accessor.get()).toBe("banana");

    txnState.cursor = 99;
    expect(accessor.get()).toBeUndefined();
  });

  test("should provide column name", () => {
    expect(accessor.name()).toBe("test");
  });
});

describe("String column edge cases", () => {
  test("should handle strings with special characters", async () => {
    const column = createStringColumn("special");

    await column.set(0, "line1\nline2");
    await column.set(1, "tab\ttab");
    await column.set(2, "quote\"quote");
    await column.set(3, "backslash\\backslash");
    await column.set(4, "null\0null");

    expect(await column.get(0)).toBe("line1\nline2");
    expect(await column.get(1)).toBe("tab\ttab");
    expect(await column.get(2)).toBe("quote\"quote");
    expect(await column.get(3)).toBe("backslash\\backslash");
    expect(await column.get(4)).toBe("null\0null");
  });

  test("should handle enum column with hash collisions gracefully", async () => {
    const column = createEnumColumn("collision_test");

    // Add many different strings to potentially trigger hash collisions
    const testStrings: string[] = [];
    for (let i = 0; i < 1000; i++) {
      testStrings.push(`string_${i}_${Math.random().toString(36).substring(7)}`);
    }

    // Set all strings
    for (let i = 0; i < testStrings.length; i++) {
      await column.setString(i, testStrings[i]);
    }

    // Verify all strings can be retrieved correctly
    for (let i = 0; i < testStrings.length; i++) {
      expect(await column.getString(i)).toBe(testStrings[i]);
    }

    // Should have all unique values
    expect(column.getUniqueValues().length).toBe(testStrings.length);
  });
});
