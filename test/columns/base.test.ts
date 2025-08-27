import { describe, test, expect, beforeEach } from "bun:test";
import { BaseColumn, ColumnReader, ColumnRegistry } from "../../src/columns/base.js";
import type { ColumnType, TransactionState } from "../../src/types.js";

// Custom reader for TestColumn that supports getString()
class TestColumnReader extends ColumnReader<string> {
  getString(): string | undefined {
    const column = (this as any).column as TestColumn;
    return column.data.get(this.getCurrentIndex());
  }
}

// Concrete implementation of BaseColumn for testing
class TestColumn extends BaseColumn<string> {
  constructor(name: string, type: ColumnType = 'string', options: Record<string, any> = {}) {
    super(name, type, options);
  }

  protected async setInternal(index: number, value: string): Promise<void> {
    this.data.set(index, value);
  }

  protected async getInternal(index: number): Promise<string | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    this.data.set(index, undefined as any);
  }

  createReader(txnState?: TransactionState): TestColumnReader {
    return new TestColumnReader(this, txnState);
  }

  async serialize(): Promise<Uint8Array> {
    // Collect all data from chunks
    const entries: Array<[number, string]> = [];
    for (const index of this.fillList) {
      const value = this.data.get(index);
      if (value !== undefined) {
        entries.push([index, value]);
      }
    }
    const json = JSON.stringify({ entries, fillList: this.fillList.array() });
    return new TextEncoder().encode(json);
  }

  async deserialize(data: Uint8Array): Promise<void> {
    const json = new TextDecoder().decode(data);
    const { entries, fillList } = JSON.parse(json);
    
    this.data.clear();
    for (const [index, value] of entries) {
      this.data.set(index, value);
    }
    
    // Restore fill list
    this.fillList.clear();
    for (const index of fillList) {
      this.fillList.add(index);
    }
  }

  clone(): TestColumn {
    const cloned = new TestColumn(this.name, this.type, this.options);
    cloned.data = this.data.clone();
    cloned.fillList = this.fillList.clone();
    return cloned;
  }
}

describe("BaseColumn", () => {
  let column: TestColumn;

  beforeEach(() => {
    column = new TestColumn("test_column", "string");
  });

  describe("constructor and basic properties", () => {
    test("should initialize with correct properties", () => {
      expect(column.getName()).toBe("test_column");
      expect(column.getType()).toBe("string");
      expect(column.isColumnDropped()).toBe(false);
    });

    test("should create schema correctly", () => {
      const schema = column.getSchema();
      expect(schema.name).toBe("test_column");
      expect(schema.type).toBe("string");
      expect(schema.options).toEqual({});
    });

    test("should handle options", () => {
      const columnWithOptions = new TestColumn("test", "string", { foo: "bar", baz: 42 });
      const schema = columnWithOptions.getSchema();
      expect(schema.options).toEqual({ foo: "bar", baz: 42 });
    });
  });

  describe("basic operations", () => {
    test("should set and get values", async () => {
      await column.set(0, "hello");
      await column.set(100, "world");
      
      expect(await column.get(0)).toBe("hello");
      expect(await column.get(100)).toBe("world");
      expect(await column.get(50)).toBeUndefined();
    });

    test("should track size correctly", async () => {
      expect(column.size()).toBe(0);
      
      await column.set(0, "a");
      expect(column.size()).toBe(1);
      
      await column.set(10, "b");
      expect(column.size()).toBe(2);
      
      await column.set(0, "updated"); // Update existing
      expect(column.size()).toBe(2);
    });

    test("should check containment correctly", async () => {
      expect(column.contains(0)).toBe(false);
      
      await column.set(0, "test");
      expect(column.contains(0)).toBe(true);
      expect(column.contains(1)).toBe(false);
    });

    test("should remove values", async () => {
      await column.set(0, "test");
      expect(column.contains(0)).toBe(true);
      
      await column.remove(0);
      expect(column.contains(0)).toBe(false);
      expect(await column.get(0)).toBeUndefined();
      expect(column.size()).toBe(0);
    });
  });

  describe("batch operations", () => {
    test("should handle batch updates", async () => {
      const updates = [
        { index: 0, value: "a" },
        { index: 1, value: "b" },
        { index: 2, value: undefined }, // Remove
        { index: 3, value: "d" }
      ];
      
      // Set initial value at index 2
      await column.set(2, "c");
      expect(column.size()).toBe(1);
      
      await column.batchUpdate(updates);
      
      expect(await column.get(0)).toBe("a");
      expect(await column.get(1)).toBe("b");
      expect(await column.get(2)).toBeUndefined();
      expect(await column.get(3)).toBe("d");
      expect(column.size()).toBe(3);
    });

    test("should handle empty batch update", async () => {
      await column.set(0, "test");
      await column.batchUpdate([]);
      
      expect(await column.get(0)).toBe("test");
      expect(column.size()).toBe(1);
    });
  });

  describe("fill list", () => {
    test("should maintain accurate fill list", async () => {
      await column.set(5, "a");
      await column.set(10, "b");
      await column.set(15, "c");
      
      const fillList = column.getFillList();
      expect(fillList.has(5)).toBe(true);
      expect(fillList.has(10)).toBe(true);
      expect(fillList.has(15)).toBe(true);
      expect(fillList.has(0)).toBe(false);
      expect(fillList.size()).toBe(3);
    });

    test("should update fill list on remove", async () => {
      await column.set(5, "test");
      expect(column.getFillList().has(5)).toBe(true);
      
      await column.remove(5);
      expect(column.getFillList().has(5)).toBe(false);
    });
  });

  describe("filter operation", () => {
    beforeEach(async () => {
      await column.set(0, "apple");
      await column.set(1, "banana");
      await column.set(2, "cherry");
      await column.set(3, "date");
      await column.set(4, "elderberry");
    });

    test("should filter based on predicate", async () => {
      const result = await column.filter((reader) => {
        const value = reader.getString();
        return value !== undefined && value.length > 5;
      });
      
      expect(result.size()).toBe(3); // "banana", "cherry", and "elderberry"
      expect(result.has(1)).toBe(true); // banana
      expect(result.has(2)).toBe(true); // cherry
      expect(result.has(4)).toBe(true); // elderberry
      expect(result.has(0)).toBe(false); // apple
      expect(result.has(3)).toBe(false); // date
    });

    test("should handle empty filter result", async () => {
      const result = await column.filter(() => false);
      expect(result.isEmpty()).toBe(true);
    });

    test("should handle filter that matches all", async () => {
      const result = await column.filter(() => true);
      expect(result.size()).toBe(5);
    });
  });

  describe("statistics", () => {
    test("should provide accurate statistics", async () => {
      await column.set(0, "a");
      await column.set(100, "b");
      await column.set(1000, "c");
      
      const stats = column.getStats();
      
      expect(stats.name).toBe("test_column");
      expect(stats.type).toBe("string");
      expect(stats.size).toBe(3);
      expect(stats.capacity).toBeGreaterThanOrEqual(stats.size);
      expect(stats.fillRatio).toBeGreaterThan(0);
      expect(stats.fillRatio).toBeLessThanOrEqual(1);
      expect(stats.memoryUsage.chunks).toBeGreaterThan(0);
      expect(stats.memoryUsage.estimatedBytes).toBeGreaterThan(0);
    });

    test("should handle empty column statistics", () => {
      const stats = column.getStats();
      
      expect(stats.size).toBe(0);
      expect(stats.fillRatio).toBe(0);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize", async () => {
      await column.set(0, "hello");
      await column.set(10, "world");
      await column.set(20, "test");
      
      const serialized = await column.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);
      
      const newColumn = new TestColumn("restored", "string");
      await newColumn.deserialize(serialized);
      
      expect(await newColumn.get(0)).toBe("hello");
      expect(await newColumn.get(10)).toBe("world");
      expect(await newColumn.get(20)).toBe("test");
      expect(newColumn.size()).toBe(3);
    });

    test("should handle empty column serialization", async () => {
      const serialized = await column.serialize();
      const newColumn = new TestColumn("restored", "string");
      await newColumn.deserialize(serialized);
      
      expect(newColumn.size()).toBe(0);
    });
  });

  describe("cloning", () => {
    test("should clone column correctly", async () => {
      await column.set(0, "original");
      await column.set(5, "data");
      
      const cloned = column.clone();
      
      expect(cloned.getName()).toBe(column.getName());
      expect(cloned.getType()).toBe(column.getType());
      expect(cloned.size()).toBe(column.size());
      expect(await cloned.get(0)).toBe("original");
      expect(await cloned.get(5)).toBe("data");
      
      // Should be independent
      await cloned.set(10, "new");
      expect(await column.get(10)).toBeUndefined();
    });
  });

  describe("dropped column behavior", () => {
    test("should prevent operations on dropped column", async () => {
      await column.set(0, "test");
      
      column.drop();
      expect(column.isColumnDropped()).toBe(true);
      
      await expect(column.set(1, "new")).rejects.toThrow("dropped");
      await expect(column.remove(0)).rejects.toThrow("dropped");
    });

    test("should allow reading from dropped column", async () => {
      await column.set(0, "test");
      column.drop();
      
      // Reading should still work
      expect(await column.get(0)).toBe("test");
    });
  });

  describe("column reader", () => {
    test("should create column reader", () => {
      const txnState = { cursor: 0 } as TransactionState;
      const reader = column.createReader(txnState);
      
      expect(reader).toBeInstanceOf(ColumnReader);
    });
  });

  describe("dirty chunk tracking", () => {
    test("should track dirty chunks", async () => {
      await column.set(0, "a");        // chunk 0
      await column.set(20000, "b");    // chunk 1
      await column.set(40000, "c");    // chunk 2
      
      const dirtyChunks = column.getDirtyChunks();
      expect(dirtyChunks.length).toBeGreaterThan(0);
    });

    test("should mark chunks as clean", async () => {
      await column.set(0, "test");
      
      const dirtyChunks = column.getDirtyChunks();
      expect(dirtyChunks.length).toBeGreaterThan(0);
      
      column.markAllClean();
      expect(column.getDirtyChunks().length).toBe(0);
    });
  });
});

describe("ColumnReader", () => {
  let column: TestColumn;
  let reader: ColumnReader;

  beforeEach(() => {
    column = new TestColumn("test", "string");
    reader = new ColumnReader(column);
  });

  test("should set and get current index", () => {
    reader.setIndex(42);
    expect(reader.getCurrentIndex()).toBe(42);
  });

  test("should throw for unsupported operations", () => {
    expect(() => reader.getString()).toThrow("not supported");
    expect(() => reader.getInt()).toThrow("not supported");
    expect(() => reader.getBigInt()).toThrow("not supported");
    expect(() => reader.getFloat()).toThrow("not supported");
    expect(() => reader.getBoolean()).toThrow("not supported");
    expect(() => reader.getRecord()).toThrow("not supported");
  });

  test("should get raw value", async () => {
    await column.set(5, "test");
    reader.setIndex(5);
    
    expect(await reader.getRaw()).toBe("test");
  });
});

describe("ColumnRegistry", () => {
  let registry: ColumnRegistry;

  beforeEach(() => {
    registry = new ColumnRegistry();
  });

  describe("registration", () => {
    test("should register columns", async () => {
      const column = new TestColumn("test", "string");
      
      await registry.register(column);
      
      expect(registry.has("test")).toBe(true);
      expect(registry.get("test")).toBe(column);
    });

    test("should prevent duplicate registration", async () => {
      const column1 = new TestColumn("test", "string");
      const column2 = new TestColumn("test", "string");
      
      await registry.register(column1);
      await expect(registry.register(column2)).rejects.toThrow("already exists");
    });

    test("should get required column", async () => {
      const column = new TestColumn("test", "string");
      await registry.register(column);
      
      expect(registry.getRequired("test")).toBe(column);
    });

    test("should throw when getting non-existent required column", () => {
      expect(() => registry.getRequired("nonexistent")).toThrow("not found");
    });
  });

  describe("column management", () => {
    beforeEach(async () => {
      await registry.register(new TestColumn("col1", "string"));
      await registry.register(new TestColumn("col2", "string"));
      await registry.register(new TestColumn("col3", "string"));
    });

    test("should list column names", () => {
      const names = registry.getNames();
      expect(names).toContain("col1");
      expect(names).toContain("col2");
      expect(names).toContain("col3");
      expect(names.length).toBe(3);
    });

    test("should get all columns", () => {
      const columns = registry.getAll();
      expect(columns.length).toBe(3);
      expect(columns.every(col => col instanceof TestColumn)).toBe(true);
    });

    test("should get schemas", () => {
      const schemas = registry.getSchemas();
      expect(schemas.length).toBe(3);
      expect(schemas[0]).toHaveProperty("name");
      expect(schemas[0]).toHaveProperty("type");
      expect(schemas[0]).toHaveProperty("options");
    });

    test("should drop columns", async () => {
      expect(registry.has("col1")).toBe(true);
      
      const dropped = await registry.drop("col1");
      expect(dropped).toBe(true);
      expect(registry.has("col1")).toBe(false);
      
      const droppedAgain = await registry.drop("col1");
      expect(droppedAgain).toBe(false);
    });
  });

  describe("statistics", () => {
    test("should provide registry statistics", async () => {
      const col1 = new TestColumn("col1", "string");
      const col2 = new TestColumn("col2", "string");
      
      await col1.set(0, "a");
      await col1.set(1, "b");
      await col2.set(0, "x");
      
      await registry.register(col1);
      await registry.register(col2);
      
      const stats = registry.getStats();
      
      expect(stats.columnCount).toBe(2);
      expect(stats.totalSize).toBe(3); // 2 + 1
      expect(stats.totalCapacity).toBeGreaterThanOrEqual(stats.totalSize);
      expect(stats.columns.length).toBe(2);
    });

    test("should handle empty registry statistics", () => {
      const stats = registry.getStats();
      
      expect(stats.columnCount).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.totalCapacity).toBe(0);
      expect(stats.columns).toEqual([]);
    });
  });

  describe("clear operation", () => {
    test("should clear all columns", async () => {
      await registry.register(new TestColumn("col1", "string"));
      await registry.register(new TestColumn("col2", "string"));
      
      expect(registry.getNames().length).toBe(2);
      
      await registry.clear();
      
      expect(registry.getNames().length).toBe(0);
      expect(registry.has("col1")).toBe(false);
      expect(registry.has("col2")).toBe(false);
    });
  });

  describe("dropped column handling", () => {
    test("should exclude dropped columns from listings", async () => {
      const column = new TestColumn("test", "string");
      await registry.register(column);
      
      expect(registry.has("test")).toBe(true);
      expect(registry.getNames()).toContain("test");
      
      column.drop();
      
      expect(registry.has("test")).toBe(false);
      expect(registry.getNames()).not.toContain("test");
    });

    test("should throw when getting required dropped column", async () => {
      const column = new TestColumn("test", "string");
      await registry.register(column);
      column.drop();
      
      expect(() => registry.getRequired("test")).toThrow("dropped");
    });
  });
});