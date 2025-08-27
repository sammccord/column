import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import {
  IndexColumn,
  IndexColumnReader,
  IndexManager,
  createIndexColumn
} from "../../src/columns/bitmap-index.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import type { TransactionState, Reader, Predicate } from "../../src/types.js";

// Mock reader for testing
class MockReader implements Reader {
  private index: number = 0;
  private data: Map<number, any> = new Map();

  setIndex(index: number): void {
    this.index = index;
  }

  getCurrentIndex(): number {
    return this.index;
  }

  getString(): string | undefined {
    const value = this.data.get(this.index);
    return typeof value === 'string' ? value : undefined;
  }

  getInt(): number | undefined {
    const value = this.data.get(this.index);
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
  }

  getBigInt(): bigint | undefined {
    const value = this.data.get(this.index);
    return typeof value === 'bigint' ? value : undefined;
  }

  getFloat(): number | undefined {
    const value = this.data.get(this.index);
    return typeof value === 'number' ? value : undefined;
  }

  getBoolean(): boolean | undefined {
    const value = this.data.get(this.index);
    return typeof value === 'boolean' ? value : undefined;
  }

  getRecord<T = any>(): T | undefined {
    return this.data.get(this.index) as T;
  }

  async getRaw(): Promise<any> {
    return this.data.get(this.index);
  }

  // Helper method to set test data
  setData(index: number, value: any): void {
    this.data.set(index, value);
  }
}

describe("IndexColumn", () => {
  let column: IndexColumn;
  let mockReader: MockReader;
  let testPredicate: Predicate;

  beforeEach(() => {
    mockReader = new MockReader();

    // Simple predicate: values greater than 10
    testPredicate = (reader: Reader) => {
      const value = reader.getInt();
      return value !== undefined && value > 10;
    };

    column = createIndexColumn("test_index", "target_column", testPredicate);
  });

  describe("basic properties", () => {
    test("should have correct target column and predicate", () => {
      expect(column.getTargetColumn()).toBe("target_column");
      expect(column.getPredicate()).toBe(testPredicate);
      expect(column.getType()).toBe("index");
      expect(column.getName()).toBe("test_index");
    });
  });

  describe("index operations", () => {
    test("should build and maintain bitmap indexes", async () => {
      // Create index entries
      const entry1 = { value: 15, bitmap: BitmapUtils.fromIndices([0, 2, 4]) };
      const entry2 = { value: 25, bitmap: BitmapUtils.fromIndices([1, 3]) };
      const entry3 = { value: 5, bitmap: BitmapUtils.fromIndices([5, 6]) };

      await column.set(0, entry1);
      await column.set(1, entry2);
      await column.set(2, entry3);

      expect(column.size()).toBe(3);

      // Test finding indices by value
      const indices15 = column.findIndices(15);
      expect(indices15.size()).toBe(3);
      expect(indices15.has(0)).toBe(true);
      expect(indices15.has(2)).toBe(true);
      expect(indices15.has(4)).toBe(true);

      const indices25 = column.findIndices(25);
      expect(indices25.size()).toBe(2);
      expect(indices25.has(1)).toBe(true);
      expect(indices25.has(3)).toBe(true);

      const indices5 = column.findIndices(5);
      expect(indices5.size()).toBe(2);
      expect(indices5.has(5)).toBe(true);
      expect(indices5.has(6)).toBe(true);
    });

    test("should handle non-existent values", () => {
      const indices = column.findIndices("nonexistent");
      expect(indices.isEmpty()).toBe(true);
    });

    test("should get all indexed values", async () => {
      const entry1 = { value: "apple", bitmap: new TypedFastBitSet([0]) };
      const entry2 = { value: "banana", bitmap: new TypedFastBitSet([1]) };
      const entry3 = { value: "cherry", bitmap: new TypedFastBitSet([2]) };

      await column.set(0, entry1);
      await column.set(1, entry2);
      await column.set(2, entry3);

      const values = column.getIndexedValues();
      expect(values).toHaveLength(3);
      expect(values).toContain("apple");
      expect(values).toContain("banana");
      expect(values).toContain("cherry");
    });

    test("should update index mappings when values change", async () => {
      const entry1 = { value: "old_value", bitmap: new TypedFastBitSet([0]) };
      await column.set(0, entry1);

      expect(column.findIndices("old_value").size()).toBe(1);

      const entry2 = { value: "new_value", bitmap: new TypedFastBitSet([0]) };
      await column.set(0, entry2);

      expect(column.findIndices("old_value").isEmpty()).toBe(true);
      expect(column.findIndices("new_value").size()).toBe(1);
    });

    test("should remove index mappings on removal", async () => {
      const entry = { value: "test_value", bitmap: new TypedFastBitSet([0]) };
      await column.set(0, entry);

      expect(column.findIndices("test_value").size()).toBe(1);

      await column.remove(0);

      expect(column.findIndices("test_value").isEmpty()).toBe(true);
      expect(column.size()).toBe(0);
    });
  });

  describe("predicate filtering", () => {
    beforeEach(() => {
      // Set up mock data
      mockReader.setData(0, 5);   // Less than 10 (should not match)
      mockReader.setData(1, 15);  // Greater than 10 (should match)
      mockReader.setData(2, 8);   // Less than 10 (should not match)
      mockReader.setData(3, 25);  // Greater than 10 (should match)
      mockReader.setData(4, 12);  // Greater than 10 (should match)
    });

    test("should filter by predicate", async () => {
      // Provide bitmap specifying which indices to check
      const checkBitmap = BitmapUtils.fromIndices([0, 1, 2, 3, 4]);
      const result = await column.filterByPredicate(mockReader, checkBitmap);

      expect(result.size()).toBe(3);
      expect(result.has(1)).toBe(true);  // 15 > 10
      expect(result.has(3)).toBe(true);  // 25 > 10
      expect(result.has(4)).toBe(true);  // 12 > 10
      expect(result.has(0)).toBe(false); // 5 <= 10
      expect(result.has(2)).toBe(false); // 8 <= 10
    });

    test("should filter with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([1, 2, 3]); // Only check indices 1, 2, 3
      const result = await column.filterByPredicate(mockReader, constraintBitmap);

      expect(result.size()).toBe(2);
      expect(result.has(1)).toBe(true);  // 15 > 10 and in constraint
      expect(result.has(3)).toBe(true);  // 25 > 10 and in constraint
      expect(result.has(4)).toBe(false); // 12 > 10 but not in constraint
    });
  });

  describe("index statistics", () => {
    test("should provide accurate statistics", async () => {
      const entry1 = { value: "a", bitmap: BitmapUtils.fromIndices([0, 1, 2]) };
      const entry2 = { value: "b", bitmap: BitmapUtils.fromIndices([3, 4]) };
      const entry3 = { value: "c", bitmap: BitmapUtils.fromIndices([5]) };

      await column.set(0, entry1);
      await column.set(1, entry2);
      await column.set(2, entry3);

      const stats = column.getIndexStats();

      expect(stats.indexedValues).toBe(3);
      expect(stats.totalMappings).toBe(6); // 3 + 2 + 1
      expect(stats.averageBitmapSize).toBe(2); // 6 / 3
      expect(stats.memoryUsage.bitmaps).toBe(3);
      expect(stats.memoryUsage.mappings).toBe(3);
      expect(stats.memoryUsage.estimatedBytes).toBeGreaterThan(0);
    });

    test("should handle empty index statistics", () => {
      const stats = column.getIndexStats();

      expect(stats.indexedValues).toBe(0);
      expect(stats.totalMappings).toBe(0);
      expect(stats.averageBitmapSize).toBe(0);
      expect(stats.memoryUsage.bitmaps).toBe(0);
      expect(stats.memoryUsage.mappings).toBe(0);
    });
  });

  describe("index rebuilding", () => {
    test("should rebuild index from reader data", async () => {
      // Set up initial data that doesn't match predicate
      const badEntry = { value: 5, bitmap: new TypedFastBitSet([0]) };
      await column.set(0, badEntry);

      expect(column.size()).toBe(1);

      // Set up mock reader with predicate-matching data
      mockReader.setData(0, 15); // Matches predicate (> 10)
      mockReader.setData(1, 25); // Matches predicate (> 10)
      mockReader.setData(2, 5);  // Doesn't match predicate (<= 10)

      // Add indices to fill list to simulate column data
      const fillList = column.getFillList();
      fillList.add(0);
      fillList.add(1);
      fillList.add(2);

      await column.rebuildIndex(mockReader);

      // Should only have entries for indices that match predicate
      const indexedValues = column.getIndexedValues();
      expect(indexedValues.length).toBeGreaterThan(0);
    });
  });

  describe("index merging", () => {
    test("should merge compatible indexes", async () => {
      const otherColumn = createIndexColumn("other_index", "target_column", testPredicate);

      // Add data to both indexes
      const entry1 = { value: "shared", bitmap: BitmapUtils.fromIndices([0, 1]) };
      const entry2 = { value: "unique1", bitmap: BitmapUtils.fromIndices([2]) };
      const entry3 = { value: "shared", bitmap: BitmapUtils.fromIndices([3, 4]) };
      const entry4 = { value: "unique2", bitmap: BitmapUtils.fromIndices([5]) };

      await column.set(0, entry1);
      await column.set(1, entry2);
      await otherColumn.set(0, entry3);
      await otherColumn.set(1, entry4);

      await column.mergeWith(otherColumn);

      // Check merged results
      const sharedIndices = column.findIndices("shared");
      expect(sharedIndices.size()).toBe(4); // [0, 1] + [3, 4]
      expect(sharedIndices.has(0)).toBe(true);
      expect(sharedIndices.has(1)).toBe(true);
      expect(sharedIndices.has(3)).toBe(true);
      expect(sharedIndices.has(4)).toBe(true);

      const unique1Indices = column.findIndices("unique1");
      expect(unique1Indices.size()).toBe(1);
      expect(unique1Indices.has(2)).toBe(true);

      const unique2Indices = column.findIndices("unique2");
      expect(unique2Indices.size()).toBe(1);
      expect(unique2Indices.has(5)).toBe(true);
    });

    test("should reject merging incompatible indexes", async () => {
      const incompatibleColumn = createIndexColumn("incompatible", "different_column", testPredicate);

      await expect(column.mergeWith(incompatibleColumn)).rejects.toThrow("Cannot merge indexes for different target columns");
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize index", async () => {
      const entry1 = { value: "test1", bitmap: BitmapUtils.fromIndices([0, 2, 4]) };
      const entry2 = { value: "test2", bitmap: BitmapUtils.fromIndices([1, 3]) };

      await column.set(0, entry1);
      await column.set(1, entry2);

      const serialized = await column.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);

      const newColumn = createIndexColumn("restored", "target_column", testPredicate);
      await newColumn.deserialize(serialized);

      expect(newColumn.size()).toBe(2);

      const test1Indices = newColumn.findIndices("test1");
      expect(test1Indices.size()).toBe(3);
      expect(test1Indices.has(0)).toBe(true);
      expect(test1Indices.has(2)).toBe(true);
      expect(test1Indices.has(4)).toBe(true);

      const test2Indices = newColumn.findIndices("test2");
      expect(test2Indices.size()).toBe(2);
      expect(test2Indices.has(1)).toBe(true);
      expect(test2Indices.has(3)).toBe(true);
    });

    test("should handle empty index serialization", async () => {
      const serialized = await column.serialize();
      const newColumn = createIndexColumn("restored", "target_column", testPredicate);
      await newColumn.deserialize(serialized);

      expect(newColumn.size()).toBe(0);
      expect(newColumn.getIndexedValues()).toHaveLength(0);
    });

    test("should validate type code on deserialization", async () => {
      const entry = { value: "test", bitmap: new TypedFastBitSet([0]) };
      await column.set(0, entry);
      const serialized = await column.serialize();

      // Corrupt the type code
      const corrupted = new Uint8Array(serialized);
      corrupted[4] = 255; // Invalid type code

      const newColumn = createIndexColumn("test", "target", testPredicate);
      await expect(newColumn.deserialize(corrupted)).rejects.toThrow("Type code mismatch");
    });
  });

  describe("cloning", () => {
    test("should clone index with all mappings", async () => {
      const entry1 = { value: "clone1", bitmap: BitmapUtils.fromIndices([0, 1]) };
      const entry2 = { value: "clone2", bitmap: BitmapUtils.fromIndices([2, 3]) };

      await column.set(0, entry1);
      await column.set(1, entry2);

      console.log(column.size())
      const cloned = column.clone();

      expect(cloned.getName()).toBe(column.getName());
      expect(cloned.getTargetColumn()).toBe(column.getTargetColumn());
      // console.log(cloned)
      expect(cloned.size()).toBe(column.size());

      // Check index mappings are cloned
      const clone1Indices = cloned.findIndices("clone1");
      expect(clone1Indices.size()).toBe(2);
      expect(clone1Indices.has(0)).toBe(true);
      expect(clone1Indices.has(1)).toBe(true);

      // Should be independent
      const entry3 = { value: "new", bitmap: new TypedFastBitSet([4]) };
      await cloned.set(2, entry3);

      expect(column.findIndices("new").isEmpty()).toBe(true);
      expect(cloned.findIndices("new").size()).toBe(1);
    });
  });
});

describe("IndexColumnReader", () => {
  let column: IndexColumn;
  let reader: IndexColumnReader;
  let testPredicate: Predicate;

  beforeEach(async () => {
    testPredicate = (reader: Reader) => true; // Simple predicate
    column = createIndexColumn("test", "target", testPredicate);
    reader = new IndexColumnReader(column);

    const entry1 = { value: "read1", bitmap: BitmapUtils.fromIndices([0, 1]) };
    const entry2 = { value: "read2", bitmap: BitmapUtils.fromIndices([2, 3]) };

    await column.set(0, entry1);
    await column.set(1, entry2);
  });

  test("should read index entries", () => {
    reader.setIndex(0);
    const entry = reader.getIndexEntry();
    expect(entry?.value).toBe("read1");
    expect(entry?.bitmap.size()).toBe(2);

    expect(reader.getValue()).toBe("read1");
    expect(reader.getBitmap()?.size()).toBe(2);

    reader.setIndex(1);
    expect(reader.getValue()).toBe("read2");
    expect(reader.getBitmap()?.size()).toBe(2);

    reader.setIndex(99);
    expect(reader.getIndexEntry()).toBeUndefined();
    expect(reader.getValue()).toBeUndefined();
    expect(reader.getBitmap()).toBeUndefined();
  });
});

describe("IndexManager", () => {
  let manager: IndexManager;
  let testPredicate1: Predicate;
  let testPredicate2: Predicate;

  beforeEach(() => {
    manager = new IndexManager();
    testPredicate1 = (reader: Reader) => (reader.getInt() || 0) > 10;
    testPredicate2 = (reader: Reader) => (reader.getString() || "").length > 5;
  });

  describe("index management", () => {
    test("should add and retrieve indexes", () => {
      const index1 = createIndexColumn("index1", "column1", testPredicate1);
      const index2 = createIndexColumn("index2", "column2", testPredicate2);

      manager.addIndex(index1);
      manager.addIndex(index2);

      expect(manager.getIndex("index1")).toBe(index1);
      expect(manager.getIndex("index2")).toBe(index2);
      expect(manager.getIndex("nonexistent")).toBeUndefined();
    });

    test("should remove indexes", () => {
      const index = createIndexColumn("test", "column", testPredicate1);
      manager.addIndex(index);

      expect(manager.getIndex("test")).toBe(index);
      expect(manager.removeIndex("test")).toBe(true);
      expect(manager.getIndex("test")).toBeUndefined();
      expect(manager.removeIndex("test")).toBe(false);
    });

    test("should get indexes for target column", () => {
      const index1 = createIndexColumn("index1", "column1", testPredicate1);
      const index2 = createIndexColumn("index2", "column1", testPredicate2);
      const index3 = createIndexColumn("index3", "column2", testPredicate1);

      manager.addIndex(index1);
      manager.addIndex(index2);
      manager.addIndex(index3);

      const column1Indexes = manager.getIndexesForColumn("column1");
      expect(column1Indexes).toHaveLength(2);
      expect(column1Indexes).toContain(index1);
      expect(column1Indexes).toContain(index2);

      const column2Indexes = manager.getIndexesForColumn("column2");
      expect(column2Indexes).toHaveLength(1);
      expect(column2Indexes).toContain(index3);
    });

    test("should find best index for predicate", () => {
      const index1 = createIndexColumn("index1", "column1", testPredicate1);
      const index2 = createIndexColumn("index2", "column1", testPredicate2);

      manager.addIndex(index1);
      manager.addIndex(index2);

      const best = manager.findBestIndex("column1", testPredicate1);
      expect(best).toBe(index1);

      const none = manager.findBestIndex("column1", (reader) => false);
      expect(none).toBeUndefined();
    });

    test("should get all index names", () => {
      const index1 = createIndexColumn("alpha", "column1", testPredicate1);
      const index2 = createIndexColumn("beta", "column2", testPredicate2);

      manager.addIndex(index1);
      manager.addIndex(index2);

      const names = manager.getIndexNames();
      expect(names).toHaveLength(2);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
    });

    test("should clear all indexes", () => {
      const index1 = createIndexColumn("index1", "column1", testPredicate1);
      const index2 = createIndexColumn("index2", "column2", testPredicate2);

      manager.addIndex(index1);
      manager.addIndex(index2);

      expect(manager.getIndexNames()).toHaveLength(2);

      manager.clear();

      expect(manager.getIndexNames()).toHaveLength(0);
      expect(manager.getIndex("index1")).toBeUndefined();
    });
  });

  describe("statistics", () => {
    test("should provide manager statistics", async () => {
      const index1 = createIndexColumn("index1", "column1", testPredicate1);
      const index2 = createIndexColumn("index2", "column2", testPredicate2);

      // Add some data to indexes
      const entry1 = { value: "test1", bitmap: BitmapUtils.fromIndices([0, 1, 2]) };
      const entry2 = { value: "test2", bitmap: BitmapUtils.fromIndices([3, 4]) };

      await index1.set(0, entry1);
      await index2.set(0, entry2);

      manager.addIndex(index1);
      manager.addIndex(index2);

      const stats = manager.getStats();

      expect(stats.indexCount).toBe(2);
      expect(stats.totalValues).toBe(2); // 1 + 1
      expect(stats.totalMappings).toBe(5); // 3 + 2
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    test("should handle empty manager statistics", () => {
      const stats = manager.getStats();

      expect(stats.indexCount).toBe(0);
      expect(stats.totalValues).toBe(0);
      expect(stats.totalMappings).toBe(0);
      expect(stats.memoryUsage).toBe(0);
    });
  });
});

describe("IndexColumn edge cases", () => {
  test("should handle complex values in index keys", async () => {
    const predicate = (reader: Reader) => true;
    const column = createIndexColumn("complex", "target", predicate);

    const complexValues = [
      { id: 1, name: "test" },
      [1, 2, 3],
      null,
      undefined,
      42,
      "string",
      true
    ];

    for (let i = 0; i < complexValues.length; i++) {
      const entry = { value: complexValues[i], bitmap: new TypedFastBitSet([i]) };
      await column.set(i, entry);
    }

    // Test that all values can be found
    for (let i = 0; i < complexValues.length; i++) {
      const indices = column.findIndices(complexValues[i]);
      expect(indices.size()).toBe(1);
      expect(indices.has(i)).toBe(true);
    }
  });

  test.skip("should handle large bitmap operations efficiently", async () => {
    const predicate = (reader: Reader) => true;
    const column = createIndexColumn("large", "target", predicate);

    // Create large bitmaps
    const largeIndices = [];
    for (let i = 0; i < 10000; i += 7) { // Every 7th index
      largeIndices.push(i);
    }

    const entry = {
      value: "large_set",
      bitmap: BitmapUtils.fromIndices(largeIndices)
    };

    await column.set(0, entry);

    const retrieved = column.findIndices("large_set");
    expect(retrieved.size()).toBe(largeIndices.length);

    // Spot check some indices
    expect(retrieved.has(0)).toBe(true);
    expect(retrieved.has(7)).toBe(true);
    expect(retrieved.has(14)).toBe(true);
    expect(retrieved.has(1)).toBe(false);
    expect(retrieved.has(8)).toBe(false);
  });

  test.skip("should handle concurrent index operations", async () => {
    const predicate = (reader: Reader) => true;
    const column = createIndexColumn("concurrent", "target", predicate);

    // Simulate concurrent updates
    const promises = [];
    for (let i = 0; i < 100; i++) {
      const entry = { value: `value_${i}`, bitmap: new TypedFastBitSet([i]) };
      promises.push(column.set(i, entry));
    }

    await Promise.all(promises);

    expect(column.size()).toBe(100);
    expect(column.getIndexedValues()).toHaveLength(100);

    // Verify all values are accessible
    for (let i = 0; i < 100; i++) {
      const indices = column.findIndices(`value_${i}`);
      expect(indices.size()).toBe(1);
      expect(indices.has(i)).toBe(true);
    }
  });
});
