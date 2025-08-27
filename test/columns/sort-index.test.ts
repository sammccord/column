import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import {
  SortIndexColumn,
  SortIndexColumnReader,
  SortIndexUtils,
  createSortIndexColumn
} from "../../src/columns/sort-index.js";
import { createStringColumn } from "../../src/columns/string.js";
import { createInt32Column } from "../../src/columns/numeric.js";
import { createRecordColumn } from "../../src/columns/record.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import type { TransactionState, Reader, SortIndexItem } from "../../src/types.js";

describe("SortIndexColumn", () => {
  let sortIndex: SortIndexColumn;
  let targetColumn: ReturnType<typeof createStringColumn>;

  beforeEach(async () => {
    targetColumn = createStringColumn("target");
    sortIndex = createSortIndexColumn(
      "string_sort_index",
      "target",
      (reader: Reader) => reader.getString() || ''
    );

    // Set up test data in target column
    await targetColumn.set(0, "banana");
    await targetColumn.set(1, "apple");
    await targetColumn.set(2, "cherry");
    await targetColumn.set(3, "date");
    await targetColumn.set(4, "elderberry");
  });

  describe("basic properties", () => {
    test("should have correct target column and properties", () => {
      expect(sortIndex.getTargetColumnName()).toBe("target");
      expect(sortIndex.getName()).toBe("string_sort_index");
      expect(sortIndex.getType()).toBe("sort-index");
      expect(typeof sortIndex.getKeyExtractor()).toBe("function");
    });

    test("should start with empty index", () => {
      expect(sortIndex.getSortedSize()).toBe(0);
      expect(sortIndex.size()).toBe(0);
    });
  });

  describe("index building and maintenance", () => {
    test("should update sort entries from target column", async () => {
      await sortIndex.updateSortEntry(0, targetColumn); // "banana"
      await sortIndex.updateSortEntry(1, targetColumn); // "apple"
      await sortIndex.updateSortEntry(2, targetColumn); // "cherry"

      expect(sortIndex.getSortedSize()).toBe(3);
      expect(sortIndex.getSortKey(0)).toBe("banana");
      expect(sortIndex.getSortKey(1)).toBe("apple");
      expect(sortIndex.getSortKey(2)).toBe("cherry");
    });

    test("should not add entries for non-existent indices", async () => {
      await sortIndex.updateSortEntry(99, targetColumn); // Index doesn't exist
      expect(sortIndex.getSortedSize()).toBe(0);
    });

    test("should remove sort entries", async () => {
      await sortIndex.updateSortEntry(0, targetColumn);
      await sortIndex.updateSortEntry(1, targetColumn);
      expect(sortIndex.getSortedSize()).toBe(2);

      await sortIndex.removeSortEntry(0);
      expect(sortIndex.getSortedSize()).toBe(1);
      expect(sortIndex.getSortKey(0)).toBeUndefined();
      expect(sortIndex.getSortKey(1)).toBe("apple");
    });

    test("should handle batch updates", async () => {
      await sortIndex.batchUpdate([0, 1, 2, 3, 4], targetColumn);

      expect(sortIndex.getSortedSize()).toBe(5);
      expect(sortIndex.getSortKey(0)).toBe("banana");
      expect(sortIndex.getSortKey(1)).toBe("apple");
      expect(sortIndex.getSortKey(2)).toBe("cherry");
      expect(sortIndex.getSortKey(3)).toBe("date");
      expect(sortIndex.getSortKey(4)).toBe("elderberry");
    });

    test("should rebuild entire index", async () => {
      // Add some entries first
      await sortIndex.updateSortEntry(0, targetColumn);
      await sortIndex.updateSortEntry(1, targetColumn);
      expect(sortIndex.getSortedSize()).toBe(2);

      // Now rebuild from target column
      await sortIndex.rebuild(targetColumn);

      expect(sortIndex.getSortedSize()).toBe(5); // All entries from target column
      const allSorted = await sortIndex.getAllSorted();
      expect(allSorted.map(item => item.key)).toEqual([
        "apple", "banana", "cherry", "date", "elderberry"
      ]);
    });

    test("should update existing entries correctly", async () => {
      await sortIndex.updateSortEntry(0, targetColumn); // "banana"
      expect(sortIndex.getSortKey(0)).toBe("banana");

      // Update target column value
      await targetColumn.set(0, "zebra");
      await sortIndex.updateSortEntry(0, targetColumn);

      expect(sortIndex.getSortKey(0)).toBe("zebra");
      expect(sortIndex.getSortedSize()).toBe(1);
    });
  });

  describe("sorted access and range queries", () => {
    beforeEach(async () => {
      await sortIndex.rebuild(targetColumn);
    });

    test("should return all items in sorted order", async () => {
      const allSorted = await sortIndex.getAllSorted();

      expect(allSorted).toHaveLength(5);
      expect(allSorted.map(item => item.key)).toEqual([
        "apple", "banana", "cherry", "date", "elderberry"
      ]);
      expect(allSorted.map(item => item.value)).toEqual([1, 0, 2, 3, 4]);
    });

    test("should perform range queries", async () => {
      const range = await sortIndex.getRange("banana", "date", true);

      expect(range).toHaveLength(3);
      expect(range.map(item => item.key)).toEqual(["banana", "cherry", "date"]);
      expect(range.map(item => item.value)).toEqual([0, 2, 3]);
    });

    test("should perform range queries with exclusion", async () => {
      const range = await sortIndex.getRange("banana", "date", false);

      expect(range).toHaveLength(2);
      expect(range.map(item => item.key)).toEqual(["banana", "cherry"]);
    });

    test("should perform open-ended range queries", async () => {
      const fromCherry = await sortIndex.getRange("cherry");
      expect(fromCherry.map(item => item.key)).toEqual(["cherry", "date", "elderberry"]);

      const toCherry = await sortIndex.getRange(undefined, "cherry", true);
      expect(toCherry.map(item => item.key)).toEqual(["apple", "banana", "cherry"]);
    });

    test("should respect limit in range queries", async () => {
      const limited = await sortIndex.getRange(undefined, undefined, false, 2);

      expect(limited).toHaveLength(2);
      expect(limited.map(item => item.key)).toEqual(["apple", "banana"]);
    });

    test("should perform reverse range queries", async () => {
      const reverse = await sortIndex.getRangeReverse("date", "banana", true);

      expect(reverse.map(item => item.key)).toEqual(["date", "cherry", "banana"]);
    });

    test("should get sorted indices and bitmaps", async () => {
      const indices = await sortIndex.getSortedIndices("banana", "date", true);
      expect(indices).toEqual([0, 2, 3]);

      const bitmap = await sortIndex.getSortedBitmap("banana", "date", true);
      expect(bitmap.has(0)).toBe(true);
      expect(bitmap.has(2)).toBe(true);
      expect(bitmap.has(3)).toBe(true);
      expect(bitmap.has(1)).toBe(false);
      expect(bitmap.has(4)).toBe(false);
    });
  });

  describe("position and boundary queries", () => {
    beforeEach(async () => {
      await sortIndex.rebuild(targetColumn);
    });

    test("should find first item greater than or equal to key", async () => {
      const gte = await sortIndex.findFirstGTE("b");
      expect(gte?.key).toBe("banana");
      expect(gte?.value).toBe(0);

      const gteExact = await sortIndex.findFirstGTE("cherry");
      expect(gteExact?.key).toBe("cherry");
      expect(gteExact?.value).toBe(2);

      const gteNone = await sortIndex.findFirstGTE("zebra");
      expect(gteNone).toBeUndefined();
    });

    test("should find last item less than or equal to key", async () => {
      const lte = await sortIndex.findLastLTE("d");
      expect(lte?.key).toBe("cherry");
      expect(lte?.value).toBe(2);

      const lteExact = await sortIndex.findLastLTE("date");
      expect(lteExact?.key).toBe("date");
      expect(lteExact?.value).toBe(3);

      const lteNone = await sortIndex.findLastLTE("a");
      expect(lteNone).toBeUndefined();
    });

    test("should get min and max keys", async () => {
      const minKey = await sortIndex.getMinKey();
      const maxKey = await sortIndex.getMaxKey();

      expect(minKey).toBe("apple");
      expect(maxKey).toBe("elderberry");
    });

    test("should handle empty index boundaries", async () => {
      const emptyIndex = createSortIndexColumn("empty", "target", (r) => r.getString() || '');

      expect(await emptyIndex.getMinKey()).toBeUndefined();
      expect(await emptyIndex.getMaxKey()).toBeUndefined();
      expect(await emptyIndex.findFirstGTE("any")).toBeUndefined();
      expect(await emptyIndex.findLastLTE("any")).toBeUndefined();
    });

    test("should check key existence", async () => {
      expect(sortIndex.hasKey("apple")).toBe(true);
      expect(sortIndex.hasKey("cherry")).toBe(true);
      expect(sortIndex.hasKey("zebra")).toBe(false);
    });
  });

  describe("custom comparators", () => {
    test("should use custom string comparator", async () => {
      // Case-insensitive comparator
      const caseInsensitiveIndex = createSortIndexColumn(
        "case_insensitive",
        "target",
        (reader: Reader) => reader.getString() || '',
        {
          comparator: (a, b) => a.toLowerCase().localeCompare(b.toLowerCase())
        }
      );

      await targetColumn.set(0, "apple");
      await targetColumn.set(1, "Banana");
      await targetColumn.set(2, "Cherry");

      await caseInsensitiveIndex.rebuild(targetColumn);

      const sorted = await caseInsensitiveIndex.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual(["apple", "Banana", "Cherry"]);
    });

    test("should handle reverse comparator", async () => {
      // Reverse alphabetical order
      const reverseIndex = createSortIndexColumn(
        "reverse",
        "target",
        (reader: Reader) => reader.getString() || '',
        {
          comparator: (a, b) => b.localeCompare(a) // Reverse comparison
        }
      );

      await reverseIndex.rebuild(targetColumn);

      const sorted = await reverseIndex.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual([
        "elderberry", "date", "cherry", "banana", "apple"
      ]);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize sort index", async () => {
      await sortIndex.rebuild(targetColumn);

      const serialized = await sortIndex.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);

      const newIndex = createSortIndexColumn(
        "restored",
        "target",
        (reader: Reader) => reader.getString() || ''
      );
      await newIndex.deserialize(serialized);

      expect(newIndex.getSortedSize()).toBe(5);

      const originalSorted = await sortIndex.getAllSorted();
      const restoredSorted = await newIndex.getAllSorted();

      expect(restoredSorted).toEqual(originalSorted);
      expect(await newIndex.getMinKey()).toBe("apple");
      expect(await newIndex.getMaxKey()).toBe("elderberry");
    });

    test("should handle empty index serialization", async () => {
      const serialized = await sortIndex.serialize();
      const newIndex = createSortIndexColumn("restored", "target", (r) => r.getString() || '');
      await newIndex.deserialize(serialized);

      expect(newIndex.getSortedSize()).toBe(0);
      expect(await newIndex.getMinKey()).toBeUndefined();
    });

    test("should validate type code on deserialization", async () => {
      await sortIndex.updateSortEntry(0, targetColumn);
      const serialized = await sortIndex.serialize();

      // Corrupt the type code
      const corrupted = new Uint8Array(serialized);
      corrupted[4] = 255; // Invalid type code

      const newIndex = createSortIndexColumn("test", "target", (r) => r.getString() || '');
      await expect(newIndex.deserialize(corrupted)).rejects.toThrow("Type code mismatch");
    });
  });

  describe("cloning", () => {
    test("should clone sort index correctly", async () => {
      await sortIndex.rebuild(targetColumn);

      const cloned = sortIndex.clone();

      expect(cloned.getName()).toBe(sortIndex.getName());
      expect(cloned.getTargetColumnName()).toBe(sortIndex.getTargetColumnName());
      expect(cloned.getSortedSize()).toBe(sortIndex.getSortedSize());

      const originalSorted = await sortIndex.getAllSorted();
      const clonedSorted = await cloned.getAllSorted();
      expect(clonedSorted).toEqual(originalSorted);

      // Should be independent
      await cloned.updateSortEntry(10, targetColumn);
      expect(sortIndex.getSortedSize()).toBe(5);
      expect(cloned.getSortedSize()).toBe(5); // Won't change since index 10 doesn't exist
    });
  });

  describe("statistics and metadata", () => {
    test("should provide sort index statistics", async () => {
      await sortIndex.rebuild(targetColumn);

      const stats = sortIndex.getSortIndexStats();

      expect(stats.name).toBe("string_sort_index");
      expect(stats.targetColumn).toBe("target");
      expect(stats.size).toBe(5);
      expect(stats.minKey).toBe("apple");
      expect(stats.maxKey).toBe("elderberry");
      expect(stats.memoryUsage.btreeNodes).toBeGreaterThan(0);
      expect(stats.memoryUsage.reverseMap).toBeGreaterThan(0);
    });

    test("should handle empty index statistics", () => {
      const stats = sortIndex.getSortIndexStats();

      expect(stats.size).toBe(0);
      expect(stats.minKey).toBeUndefined();
      expect(stats.maxKey).toBeUndefined();
    });
  });

  describe("error handling", () => {
    test("should throw error when trying to set values directly", async () => {
      const item: SortIndexItem = { key: "test", value: 0 };
      await expect(sortIndex.set(0, item)).rejects.toThrow("computed and cannot be set directly");
    });

    test("should handle errors in key extraction gracefully", async () => {
      const faultyExtractor = () => {
        throw new Error("Extraction failed");
      };

      const faultyIndex = createSortIndexColumn("faulty", "target", faultyExtractor);

      // Should not throw, but log warning
      await faultyIndex.updateSortEntry(0, targetColumn);
      expect(faultyIndex.getSortedSize()).toBe(0);
    });
  });
});

describe("SortIndexColumnReader", () => {
  let sortIndex: SortIndexColumn;
  let targetColumn: ReturnType<typeof createStringColumn>;
  let reader: SortIndexColumnReader;

  beforeEach(async () => {
    targetColumn = createStringColumn("target");
    sortIndex = createSortIndexColumn("test", "target", (r) => r.getString() || '');
    reader = new SortIndexColumnReader(sortIndex);

    await targetColumn.set(0, "banana");
    await targetColumn.set(1, "apple");
    await sortIndex.rebuild(targetColumn);
  });

  test("should read sort keys and items", () => {
    reader.setIndex(0);
    expect(reader.getSortKey()).toBe("banana");

    const item = reader.getSortItem();
    expect(item?.key).toBe("banana");
    expect(item?.value).toBe(0);

    reader.setIndex(1);
    expect(reader.getSortKey()).toBe("apple");

    reader.setIndex(99);
    expect(reader.getSortKey()).toBeUndefined();
    expect(reader.getSortItem()).toBeUndefined();
  });
});

describe("SortIndexUtils", () => {
  let stringColumn: ReturnType<typeof createStringColumn>;
  let numericColumn: ReturnType<typeof createInt32Column>;
  let recordColumn: ReturnType<typeof createRecordColumn>;

  beforeEach(async () => {
    stringColumn = createStringColumn("strings");
    numericColumn = createInt32Column("numbers");
    recordColumn = createRecordColumn("records");

    // Set up test data
    await stringColumn.set(0, "zebra");
    await stringColumn.set(1, "apple");
    await stringColumn.set(2, "monkey");

    await numericColumn.set(0, 100);
    await numericColumn.set(1, 5);
    await numericColumn.set(2, 42);

    await recordColumn.set(0, {
      name: "Alice",
      age: 30,
      date: new Date("2023-01-01"),
      profile: { city: "New York" }
    });
    await recordColumn.set(1, {
      name: "Bob",
      age: 25,
      date: new Date("2023-06-15"),
      profile: { city: "London" }
    });
  });

  describe("string sort index", () => {
    test("should create and use string sort index", async () => {
      const index = SortIndexUtils.createStringIndex("string_index", "strings");
      await index.rebuild(stringColumn);

      const sorted = await index.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual(["apple", "monkey", "zebra"]);
    });

    test("should use custom string comparator", async () => {
      const index = SortIndexUtils.createStringIndex(
        "string_index",
        "strings",
        (a, b) => b.localeCompare(a) // Reverse order
      );
      await index.rebuild(stringColumn);

      const sorted = await index.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual(["zebra", "monkey", "apple"]);
    });
  });

  describe("numeric sort index", () => {
    test("should create and use numeric sort index", async () => {
      const index = SortIndexUtils.createNumericIndex("numeric_index", "numbers");
      await index.rebuild(numericColumn);

      const sorted = await index.getAllSorted();
      const values = sorted.map(item => parseInt(item.key));
      expect(values).toEqual([5, 42, 100]);
    });

    test("should handle negative numbers correctly", async () => {
      await numericColumn.set(3, -10);
      await numericColumn.set(4, -5);

      const index = SortIndexUtils.createNumericIndex("numeric_index", "numbers");
      await index.rebuild(numericColumn);

      const sorted = await index.getAllSorted();
      const values = sorted.map(item => parseInt(item.key));
      expect(values).toEqual([-10, -5, 5, 42, 100]);
    });
  });

  describe("date sort index", () => {
    test("should create and use date sort index", async () => {
      const index = SortIndexUtils.createDateIndex("date_index", "records");
      await index.rebuild(recordColumn);

      const sorted = await index.getAllSorted();
      expect(sorted).toHaveLength(2);

      // Earlier date should come first
      const dates = sorted.map(item => new Date(item.key));
      expect(dates[0] < dates[1]).toBe(true);
    });

    test("should handle missing dates", async () => {
      await recordColumn.set(2, { name: "Charlie", age: 35 }); // No date

      const index = SortIndexUtils.createDateIndex("date_index", "records");
      await index.rebuild(recordColumn);

      const sorted = await index.getAllSorted();
      expect(sorted).toHaveLength(3);
      expect(sorted[0].key).toBe(''); // Missing date becomes empty string
    });
  });

  describe("record field sort index", () => {
    test("should create sort index for simple field", async () => {
      const index = SortIndexUtils.createRecordFieldIndex("name_index", "records", "name");
      await index.rebuild(recordColumn);

      const sorted = await index.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual(["Alice", "Bob"]);
    });

    test("should create sort index for nested field", async () => {
      const index = SortIndexUtils.createRecordFieldIndex("city_index", "records", "profile.city");
      await index.rebuild(recordColumn);

      const sorted = await index.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual(["London", "New York"]);
    });

    test("should handle missing nested fields", async () => {
      await recordColumn.set(2, { name: "Charlie" }); // No profile

      const index = SortIndexUtils.createRecordFieldIndex("city_index", "records", "profile.city");
      await index.rebuild(recordColumn);

      const sorted = await index.getAllSorted();
      expect(sorted).toHaveLength(3);
      expect(sorted[0].key).toBe(''); // Missing field becomes empty string
    });

    test("should use custom comparator for record fields", async () => {
      const index = SortIndexUtils.createRecordFieldIndex(
        "name_index",
        "records",
        "name",
        (a, b) => b.localeCompare(a) // Reverse order
      );
      await index.rebuild(recordColumn);

      const sorted = await index.getAllSorted();
      expect(sorted.map(item => item.key)).toEqual(["Bob", "Alice"]);
    });
  });
});

describe("SortIndexColumn edge cases", () => {
  test("should handle large datasets efficiently", async () => {
    const largeColumn = createStringColumn("large");
    const sortIndex = SortIndexUtils.createStringIndex("large_index", "large");

    // Add many entries
    const data = [];
    for (let i = 0; i < 1000; i++) {
      const value = `item_${i.toString().padStart(4, '0')}`;
      data.push(value);
      await largeColumn.set(i, value);
    }

    await sortIndex.rebuild(largeColumn);

    expect(sortIndex.getSortedSize()).toBe(1000);

    // Test range query on large dataset
    const range = await sortIndex.getRange("item_0100", "item_0110", true, 5);
    expect(range).toHaveLength(5);
    expect(range[0].key).toBe("item_0100");
  });

  test("should handle duplicate sort keys correctly", async () => {
    const stringColumn = createStringColumn("duplicates");
    const sortIndex = SortIndexUtils.createStringIndex("dup_index", "duplicates");

    await stringColumn.set(0, "same");
    await stringColumn.set(1, "same");
    await stringColumn.set(2, "same");
    await stringColumn.set(3, "different");

    await sortIndex.rebuild(stringColumn);

    const sorted = await sortIndex.getAllSorted();
    expect(sorted).toHaveLength(4);

    // Should be sorted by key first, then by value (index) for stable sorting
    const sameItems = sorted.filter(item => item.key === "same");
    expect(sameItems.map(item => item.value)).toEqual([0, 1, 2]);
  });

  test("should handle special string values", async () => {
    const stringColumn = createStringColumn("special");
    const sortIndex = SortIndexUtils.createStringIndex("special_index", "special");

    await stringColumn.set(0, "");           // Empty string
    await stringColumn.set(1, " ");          // Space
    await stringColumn.set(2, "123");        // Numeric string
    await stringColumn.set(3, "🚀emoji");    // Unicode emoji
    await stringColumn.set(4, "café");       // Accented characters

    await sortIndex.rebuild(stringColumn);

    const sorted = await sortIndex.getAllSorted();
    expect(sorted).toHaveLength(5);

    // Verify all special values are handled
    expect(sorted.some(item => item.key === "")).toBe(true);
    expect(sorted.some(item => item.key === "🚀emoji")).toBe(true);
    expect(sorted.some(item => item.key === "café")).toBe(true);
  });

  test("should handle concurrent operations safely", async () => {
    const stringColumn = createStringColumn("concurrent");
    const sortIndex = SortIndexUtils.createStringIndex("concurrent_index", "concurrent");

    // Set up initial data
    for (let i = 0; i < 10; i++) {
      await stringColumn.set(i, `item_${i}`);
    }

    // Simulate concurrent updates
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(sortIndex.updateSortEntry(i, stringColumn));
    }

    await Promise.all(promises);

    expect(sortIndex.getSortedSize()).toBe(10);

    const sorted = await sortIndex.getAllSorted();
    expect(sorted).toHaveLength(10);

    // Verify all items are properly sorted
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i-1].key.localeCompare(sorted[i].key)).toBeLessThanOrEqual(0);
    }
  });
});
