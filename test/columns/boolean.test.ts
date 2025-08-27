import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import { 
  BooleanColumn, 
  BooleanColumnReader, 
  BooleanColumnAccessor,
  createBooleanColumn 
} from "../../src/columns/boolean.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import type { TransactionState } from "../../src/types.js";

describe("BooleanColumn", () => {
  let column: BooleanColumn;

  beforeEach(() => {
    column = createBooleanColumn("test_boolean");
  });

  describe("basic operations", () => {
    test("should set and get boolean values", async () => {
      await column.set(0, true);
      await column.set(1, false);
      await column.set(2, true);
      
      expect(await column.get(0)).toBe(true);
      expect(await column.get(1)).toBe(false);
      expect(await column.get(2)).toBe(true);
      expect(await column.get(3)).toBeUndefined();
    });

    test("should validate boolean types", async () => {
      await expect(column.set(0, "true" as any)).rejects.toThrow("Expected boolean value");
      await expect(column.set(0, 1 as any)).rejects.toThrow("Expected boolean value");
      await expect(column.set(0, null as any)).rejects.toThrow("Expected boolean value");
    });

    test("should track size correctly", async () => {
      expect(column.size()).toBe(0);
      
      await column.set(0, true);
      expect(column.size()).toBe(1);
      
      await column.set(1, false);
      expect(column.size()).toBe(2);
      
      await column.set(0, false); // Update existing
      expect(column.size()).toBe(2);
    });

    test("should remove values", async () => {
      await column.set(0, true);
      await column.set(1, false);
      
      expect(column.size()).toBe(2);
      
      await column.remove(0);
      expect(await column.get(0)).toBeUndefined();
      expect(column.size()).toBe(1);
      
      await column.remove(1);
      expect(await column.get(1)).toBeUndefined();
      expect(column.size()).toBe(0);
    });
  });

  describe("bitmap operations", () => {
    beforeEach(async () => {
      await column.set(0, true);   // index 0: true
      await column.set(1, false);  // index 1: false
      await column.set(2, true);   // index 2: true
      await column.set(3, false);  // index 3: false
      await column.set(4, true);   // index 4: true
    });

    test("should get true values bitmap", () => {
      const trueBitmap = column.getTrueBitmap();
      
      expect(trueBitmap.size()).toBe(3);
      expect(trueBitmap.has(0)).toBe(true);
      expect(trueBitmap.has(2)).toBe(true);
      expect(trueBitmap.has(4)).toBe(true);
      expect(trueBitmap.has(1)).toBe(false);
      expect(trueBitmap.has(3)).toBe(false);
    });

    test("should get false values bitmap", () => {
      const falseBitmap = column.getFalseBitmap();
      
      expect(falseBitmap.size()).toBe(2);
      expect(falseBitmap.has(1)).toBe(true);
      expect(falseBitmap.has(3)).toBe(true);
      expect(falseBitmap.has(0)).toBe(false);
      expect(falseBitmap.has(2)).toBe(false);
      expect(falseBitmap.has(4)).toBe(false);
    });

    test("should count true values", () => {
      expect(column.countTrue()).toBe(3);
      
      // With bitmap filter
      const filterBitmap = BitmapUtils.fromIndices([0, 1, 2]); // first 3 indices
      expect(column.countTrue(filterBitmap)).toBe(2); // indices 0 and 2 are true
    });

    test("should count false values", () => {
      expect(column.countFalse()).toBe(2);
      
      // With bitmap filter
      const filterBitmap = BitmapUtils.fromIndices([1, 3, 4]); // indices 1, 3, 4
      expect(column.countFalse(filterBitmap)).toBe(2); // indices 1 and 3 are false
    });

    test("should filter by boolean value", async () => {
      const trueFilter = await column.filterByValue(true);
      expect(trueFilter.size()).toBe(3);
      expect(trueFilter.has(0)).toBe(true);
      expect(trueFilter.has(2)).toBe(true);
      expect(trueFilter.has(4)).toBe(true);
      
      const falseFilter = await column.filterByValue(false);
      expect(falseFilter.size()).toBe(2);
      expect(falseFilter.has(1)).toBe(true);
      expect(falseFilter.has(3)).toBe(true);
    });

    test("should filter with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([0, 1, 2]);
      
      const trueFilter = await column.filterByValue(true, constraintBitmap);
      expect(trueFilter.size()).toBe(2); // indices 0 and 2
      expect(trueFilter.has(0)).toBe(true);
      expect(trueFilter.has(2)).toBe(true);
      expect(trueFilter.has(4)).toBe(false); // not in constraint
    });
  });

  describe("memory efficiency", () => {
    test("should use minimal memory for boolean storage", async () => {
      // Add many boolean values
      for (let i = 0; i < 10000; i++) {
        await column.set(i, i % 2 === 0);
      }
      
      expect(column.size()).toBe(10000);
      expect(column.countTrue()).toBe(5000);
      expect(column.countFalse()).toBe(5000);
      
      // Verify memory usage is reasonable
      const stats = column.getStats();
      expect(stats.size).toBe(10000);
      expect(stats.trueCount).toBe(5000);
      expect(stats.falseCount).toBe(5000);
      expect(stats.trueFillRatio).toBe(0.5);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize", async () => {
      await column.set(0, true);
      await column.set(5, false);
      await column.set(10, true);
      await column.set(15, false);
      await column.set(100, true);
      
      const serialized = await column.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);
      
      const newColumn = createBooleanColumn("restored");
      await newColumn.deserialize(serialized);
      
      expect(await newColumn.get(0)).toBe(true);
      expect(await newColumn.get(5)).toBe(false);
      expect(await newColumn.get(10)).toBe(true);
      expect(await newColumn.get(15)).toBe(false);
      expect(await newColumn.get(100)).toBe(true);
      expect(newColumn.size()).toBe(5);
      expect(newColumn.countTrue()).toBe(3);
      expect(newColumn.countFalse()).toBe(2);
    });

    test("should handle empty boolean column serialization", async () => {
      const serialized = await column.serialize();
      const newColumn = createBooleanColumn("restored");
      await newColumn.deserialize(serialized);
      
      expect(newColumn.size()).toBe(0);
      expect(newColumn.countTrue()).toBe(0);
      expect(newColumn.countFalse()).toBe(0);
    });
  });

  describe("cloning", () => {
    test("should clone correctly", async () => {
      await column.set(0, true);
      await column.set(1, false);
      await column.set(2, true);
      
      const cloned = column.clone();
      
      expect(cloned.getName()).toBe(column.getName());
      expect(cloned.size()).toBe(column.size());
      expect(await cloned.get(0)).toBe(true);
      expect(await cloned.get(1)).toBe(false);
      expect(await cloned.get(2)).toBe(true);
      expect(cloned.countTrue()).toBe(2);
      expect(cloned.countFalse()).toBe(1);
      
      // Should be independent
      await cloned.set(3, false);
      expect(await column.get(3)).toBeUndefined();
    });
  });

  describe("statistics", () => {
    test("should provide enhanced statistics", async () => {
      await column.set(0, true);
      await column.set(1, false);
      await column.set(2, true);
      await column.set(3, true);
      
      const stats = column.getStats();
      
      expect(stats.name).toBe("test_boolean");
      expect(stats.type).toBe("boolean");
      expect(stats.size).toBe(4);
      expect(stats.trueCount).toBe(3);
      expect(stats.falseCount).toBe(1);
      expect(stats.trueFillRatio).toBe(0.75); // 3/4
    });
  });
});

describe("BooleanColumnReader", () => {
  let column: BooleanColumn;
  let reader: BooleanColumnReader;

  beforeEach(async () => {
    column = createBooleanColumn("test");
    reader = new BooleanColumnReader(column);
    
    await column.set(0, true);
    await column.set(1, false);
  });

  test("should read boolean values", () => {
    reader.setIndex(0);
    expect(reader.getBoolean()).toBe(true);
    
    reader.setIndex(1);
    expect(reader.getBoolean()).toBe(false);
    
    reader.setIndex(99);
    expect(reader.getBoolean()).toBeUndefined();
  });
});

describe("BooleanColumnAccessor", () => {
  let column: BooleanColumn;
  let accessor: BooleanColumnAccessor;
  let txnState: TransactionState;

  beforeEach(async () => {
    column = createBooleanColumn("test");
    await column.set(0, true);
    await column.set(1, false);
    await column.set(2, true);
    
    txnState = {
      cursor: 0,
      setup: false,
      index: new TypedFastBitSet(),
      dirty: new TypedFastBitSet(),
      columns: new Map()
    };
    
    accessor = new BooleanColumnAccessor(column, txnState);
  });

  test("should get current value", () => {
    txnState.cursor = 0;
    expect(accessor.get()).toBe(true);
    
    txnState.cursor = 1;
    expect(accessor.get()).toBe(false);
    
    txnState.cursor = 2;
    expect(accessor.get()).toBe(true);
    
    txnState.cursor = 99;
    expect(accessor.get()).toBeUndefined();
  });

  test("should provide column name", () => {
    expect(accessor.name()).toBe("test");
  });
});

describe("BooleanColumn edge cases", () => {
  test("should handle sparse boolean data efficiently", async () => {
    const column = createBooleanColumn("sparse");
    
    // Set boolean values at sparse indices
    await column.set(0, true);
    await column.set(1000, false);
    await column.set(10000, true);
    await column.set(100000, false);
    
    expect(column.size()).toBe(4);
    expect(column.countTrue()).toBe(2);
    expect(column.countFalse()).toBe(2);
    
    expect(await column.get(0)).toBe(true);
    expect(await column.get(1000)).toBe(false);
    expect(await column.get(10000)).toBe(true);
    expect(await column.get(100000)).toBe(false);
    
    // Gaps should be undefined
    expect(await column.get(500)).toBeUndefined();
    expect(await column.get(50000)).toBeUndefined();
  });

  test("should handle updates correctly", async () => {
    const column = createBooleanColumn("updates");
    
    // Initial state
    await column.set(0, true);
    await column.set(1, false);
    
    expect(column.countTrue()).toBe(1);
    expect(column.countFalse()).toBe(1);
    
    // Update true to false
    await column.set(0, false);
    expect(column.countTrue()).toBe(0);
    expect(column.countFalse()).toBe(2);
    
    // Update false to true
    await column.set(1, true);
    expect(column.countTrue()).toBe(1);
    expect(column.countFalse()).toBe(1);
    
    // Verify final state
    expect(await column.get(0)).toBe(false);
    expect(await column.get(1)).toBe(true);
  });

  test("should handle removal correctly", async () => {
    const column = createBooleanColumn("removal");
    
    await column.set(0, true);
    await column.set(1, false);
    await column.set(2, true);
    
    expect(column.size()).toBe(3);
    expect(column.countTrue()).toBe(2);
    expect(column.countFalse()).toBe(1);
    
    // Remove true value
    await column.remove(0);
    expect(column.size()).toBe(2);
    expect(column.countTrue()).toBe(1);
    expect(column.countFalse()).toBe(1);
    
    // Remove false value
    await column.remove(1);
    expect(column.size()).toBe(1);
    expect(column.countTrue()).toBe(1);
    expect(column.countFalse()).toBe(0);
    
    // Final state
    expect(await column.get(0)).toBeUndefined();
    expect(await column.get(1)).toBeUndefined();
    expect(await column.get(2)).toBe(true);
  });

  test("should handle bitmap operations with empty column", () => {
    const column = createBooleanColumn("empty");
    
    expect(column.getTrueBitmap().isEmpty()).toBe(true);
    expect(column.getFalseBitmap().isEmpty()).toBe(true);
    expect(column.countTrue()).toBe(0);
    expect(column.countFalse()).toBe(0);
  });
});