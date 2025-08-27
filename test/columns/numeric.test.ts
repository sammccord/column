import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import {
  NumericColumn,
  NumericColumnReader,
  NumericColumnAccessor,
  createInt8Column,
  createInt16Column,
  createInt32Column,
  createInt64Column,
  createUint8Column,
  createUint16Column,
  createUint32Column,
  createUint64Column,
  createFloat32Column,
  createFloat64Column
} from "../../src/columns/numeric.js";
import type { NumericType, TransactionState } from "../../src/types.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";

describe("NumericColumn", () => {
  describe("factory functions", () => {
    test("should create all numeric column types", () => {
      expect(createInt8Column("test")).toBeInstanceOf(NumericColumn);
      expect(createInt16Column("test")).toBeInstanceOf(NumericColumn);
      expect(createInt32Column("test")).toBeInstanceOf(NumericColumn);
      expect(createInt64Column("test")).toBeInstanceOf(NumericColumn);
      expect(createUint8Column("test")).toBeInstanceOf(NumericColumn);
      expect(createUint16Column("test")).toBeInstanceOf(NumericColumn);
      expect(createUint32Column("test")).toBeInstanceOf(NumericColumn);
      expect(createUint64Column("test")).toBeInstanceOf(NumericColumn);
      expect(createFloat32Column("test")).toBeInstanceOf(NumericColumn);
      expect(createFloat64Column("test")).toBeInstanceOf(NumericColumn);
    });

    test("should have correct numeric types", () => {
      expect(createInt32Column("test").getNumericType()).toBe("int32");
      expect(createFloat64Column("test").getNumericType()).toBe("float64");
      expect(createUint64Column("test").getNumericType()).toBe("uint64");
    });
  });

  describe("type properties", () => {
    test("should identify floating point types", () => {
      expect(createInt32Column("test").isFloatingPoint()).toBe(false);
      expect(createFloat32Column("test").isFloatingPoint()).toBe(true);
      expect(createFloat64Column("test").isFloatingPoint()).toBe(true);
    });

    test("should identify 64-bit types", () => {
      expect(createInt32Column("test").is64Bit()).toBe(false);
      expect(createInt64Column("test").is64Bit()).toBe(true);
      expect(createUint64Column("test").is64Bit()).toBe(true);
    });
  });

  describe("basic operations", () => {
    let int32Column: NumericColumn<'int32'>;
    let float64Column: NumericColumn<'float64'>;
    let bigintColumn: NumericColumn<'int64'>;

    beforeEach(() => {
      int32Column = createInt32Column("int32_test");
      float64Column = createFloat64Column("float64_test");
      bigintColumn = createInt64Column("int64_test");
    });

    test("should set and get integer values", async () => {
      await int32Column.set(0, 42);
      await int32Column.set(1, -100);
      await int32Column.set(2, 0);

      expect(await int32Column.get(0)).toBe(42);
      expect(await int32Column.get(1)).toBe(-100);
      expect(await int32Column.get(2)).toBe(0);
      expect(await int32Column.get(3)).toBeUndefined();
    });

    test("should set and get float values", async () => {
      await float64Column.set(0, 3.14);
      await float64Column.set(1, -2.5);
      await float64Column.set(2, 0.0);

      expect(await float64Column.get(0)).toBe(3.14);
      expect(await float64Column.get(1)).toBe(-2.5);
      expect(await float64Column.get(2)).toBe(0.0);
    });

    test("should set and get bigint values", async () => {
      await bigintColumn.set(0, 9007199254740991n);
      await bigintColumn.set(1, -9007199254740991n);
      await bigintColumn.set(2, 0n);

      expect(await bigintColumn.get(0)).toBe(9007199254740991n);
      expect(await bigintColumn.get(1)).toBe(-9007199254740991n);
      expect(await bigintColumn.get(2)).toBe(0n);
    });

    test("should validate value types", async () => {
      await expect(int32Column.set(0, "not a number" as any)).rejects.toThrow("Invalid value type");
      await expect(bigintColumn.set(0, 42 as any)).rejects.toThrow("Invalid value type");
      await expect(float64Column.set(0, "text" as any)).rejects.toThrow("Invalid value type");
    });

    test("should handle special float values", async () => {
      await float64Column.set(0, Infinity);
      await float64Column.set(1, -Infinity);
      await float64Column.set(2, NaN);

      expect(await float64Column.get(0)).toBe(Infinity);
      expect(await float64Column.get(1)).toBe(-Infinity);
      expect(Number.isNaN(await float64Column.get(2))).toBe(true);
    });
  });

  describe("aggregation operations", () => {
    let column: NumericColumn<'int32'>;
    let bigintColumn: NumericColumn<'int64'>;

    beforeEach(async () => {
      column = createInt32Column("test");
      bigintColumn = createInt64Column("bigint_test");

      // Set up test data: [10, 20, 30, 40, 50] at indices [0, 2, 4, 6, 8]
      await column.set(0, 10);
      await column.set(2, 20);
      await column.set(4, 30);
      await column.set(6, 40);
      await column.set(8, 50);

      // BigInt data
      await bigintColumn.set(0, 100n);
      await bigintColumn.set(1, 200n);
      await bigintColumn.set(2, 300n);
    });

    test("should sum all values", async () => {
      const sum = await column.sum();
      expect(sum).toBe(150); // 10 + 20 + 30 + 40 + 50
    });

    test("should sum with bitmap filter", async () => {
      const bitmap = BitmapUtils.fromIndices([0, 4, 8]); // indices with values 10, 30, 50
      const sum = await column.sum(bitmap);
      expect(sum).toBe(90); // 10 + 30 + 50
    });

    test("should sum bigint values", async () => {
      const sum = await bigintColumn.sum();
      expect(sum).toBe(600n); // 100n + 200n + 300n
    });

    test("should find minimum value", async () => {
      const min = await column.min();
      expect(min).toBe(10);
    });

    test("should find minimum with bitmap", async () => {
      const bitmap = BitmapUtils.fromIndices([2, 6, 8]); // values 20, 40, 50
      const min = await column.min(bitmap);
      expect(min).toBe(20);
    });

    test("should find maximum value", async () => {
      const max = await column.max();
      expect(max).toBe(50);
    });

    test("should find maximum with bitmap", async () => {
      const bitmap = BitmapUtils.fromIndices([0, 2, 4]); // values 10, 20, 30
      const max = await column.max(bitmap);
      expect(max).toBe(30);
    });

    test("should calculate average", async () => {
      const avg = await column.avg();
      expect(avg).toBe(30); // 150 / 5
    });

    test("should calculate average with bitmap", async () => {
      const bitmap = BitmapUtils.fromIndices([0, 8]); // values 10, 50
      const avg = await column.avg(bitmap);
      expect(avg).toBe(30); // (10 + 50) / 2
    });

    test("should handle empty aggregations", async () => {
      const emptyColumn = createInt32Column("empty");

      expect(await emptyColumn.sum()).toBe(0);
      expect(await emptyColumn.min()).toBeUndefined();
      expect(await emptyColumn.max()).toBeUndefined();
      expect(await emptyColumn.avg()).toBe(0);
    });

    test("should handle empty bitmap aggregations", async () => {
      const emptyBitmap = new TypedFastBitSet();

      expect(await column.sum(emptyBitmap)).toBe(0);
      expect(await column.min(emptyBitmap)).toBeUndefined();
      expect(await column.max(emptyBitmap)).toBeUndefined();
      expect(await column.avg(emptyBitmap)).toBe(0);
    });
  });

  describe("boundary values", () => {
    test("should handle integer boundaries", async () => {
      const int32Col = createInt32Column("int32");
      const uint32Col = createUint32Column("uint32");

      await int32Col.set(0, 2147483647);  // Max int32
      await int32Col.set(1, -2147483648); // Min int32
      await uint32Col.set(0, 4294967295); // Max uint32
      await uint32Col.set(1, 0);          // Min uint32

      expect(await int32Col.get(0)).toBe(2147483647);
      expect(await int32Col.get(1)).toBe(-2147483648);
      expect(await uint32Col.get(0)).toBe(4294967295);
      expect(await uint32Col.get(1)).toBe(0);
    });

    test("should handle bigint boundaries", async () => {
      const int64Col = createInt64Column("int64");

      const maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
      const minBigInt = BigInt(Number.MIN_SAFE_INTEGER);

      await int64Col.set(0, maxBigInt);
      await int64Col.set(1, minBigInt);

      expect(await int64Col.get(0)).toBe(maxBigInt);
      expect(await int64Col.get(1)).toBe(minBigInt);
    });

    test("should handle float boundaries", async () => {
      const float64Col = createFloat64Column("float64");

      await float64Col.set(0, Number.MAX_VALUE);
      await float64Col.set(1, Number.MIN_VALUE);
      await float64Col.set(2, -Number.MAX_VALUE);

      expect(await float64Col.get(0)).toBe(Number.MAX_VALUE);
      expect(await float64Col.get(1)).toBe(Number.MIN_VALUE);
      expect(await float64Col.get(2)).toBe(-Number.MAX_VALUE);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize int32 column", async () => {
      const original = createInt32Column("test");
      await original.set(0, 42);
      await original.set(100, -123);
      await original.set(1000, 0);

      const serialized = await original.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);

      const restored = createInt32Column("restored");
      await restored.deserialize(serialized);

      expect(await restored.get(0)).toBe(42);
      expect(await restored.get(100)).toBe(-123);
      expect(await restored.get(1000)).toBe(0);
      expect(restored.size()).toBe(3);
    });

    test("should serialize and deserialize float64 column", async () => {
      const original = createFloat64Column("test");
      await original.set(0, 3.14159);
      await original.set(1, -2.71828);
      await original.set(2, Infinity);

      const serialized = await original.serialize();
      const restored = createFloat64Column("restored");
      await restored.deserialize(serialized);

      expect(await restored.get(0)).toBeCloseTo(3.14159, 5);
      expect(await restored.get(1)).toBeCloseTo(-2.71828, 5);
      expect(await restored.get(2)).toBe(Infinity);
    });

    test("should serialize and deserialize bigint column", async () => {
      const original = createInt64Column("test");
      await original.set(0, 9007199254740991n);
      await original.set(1, -9007199254740991n);
      await original.set(2, 0n);

      const serialized = await original.serialize();
      const restored = createInt64Column("restored");
      await restored.deserialize(serialized);

      expect(await restored.get(0)).toBe(9007199254740991n);
      expect(await restored.get(1)).toBe(-9007199254740991n);
      expect(await restored.get(2)).toBe(0n);
    });

    test("should handle type code mismatch", async () => {
      const int32Col = createInt32Column("test");
      await int32Col.set(0, 42);
      const serialized = await int32Col.serialize();

      const float64Col = createFloat64Column("test");
      await expect(float64Col.deserialize(serialized)).rejects.toThrow("Type code mismatch");
    });
  });

  describe("cloning", () => {
    test("should clone column correctly", async () => {
      const original = createInt32Column("original");
      await original.set(0, 10);
      await original.set(5, 50);
      await original.set(10, 100);

      const cloned = original.clone();

      expect(cloned.getName()).toBe("original");
      expect(cloned.getNumericType()).toBe("int32");
      expect(cloned.size()).toBe(3);
      expect(await cloned.get(0)).toBe(10);
      expect(await cloned.get(5)).toBe(50);
      expect(await cloned.get(10)).toBe(100);

      // Should be independent
      await cloned.set(15, 150);
      expect(await original.get(15)).toBeUndefined();
    });
  });
});

describe("NumericColumnReader", () => {
  let column: NumericColumn<'int32'>;
  let bigintColumn: NumericColumn<'int64'>;
  let floatColumn: NumericColumn<'float64'>;
  let reader: NumericColumnReader<'int32'>;
  let bigintReader: NumericColumnReader<'int64'>;
  let floatReader: NumericColumnReader<'float64'>;

  beforeEach(async () => {
    column = createInt32Column("test");
    bigintColumn = createInt64Column("bigint_test");
    floatColumn = createFloat64Column("float_test");

    reader = new NumericColumnReader(column);
    bigintReader = new NumericColumnReader(bigintColumn);
    floatReader = new NumericColumnReader(floatColumn);

    await column.set(0, 42);
    await column.set(1, -100);
    await bigintColumn.set(0, 9007199254740991n);
    await floatColumn.set(0, 3.14159);
  });

  test("should read int values", () => {
    reader.setIndex(0);
    expect(reader.getInt()).toBe(42);

    reader.setIndex(1);
    expect(reader.getInt()).toBe(-100);

    reader.setIndex(99);
    expect(reader.getInt()).toBeUndefined();
  });

  test("should read bigint values", () => {
    bigintReader.setIndex(0);
    expect(bigintReader.getBigInt()).toBe(9007199254740991n);

    // Regular columns should convert to BigInt
    reader.setIndex(0);
    expect(reader.getBigInt()).toBe(42n);
  });

  test("should read float values", () => {
    floatReader.setIndex(0);
    expect(floatReader.getFloat()).toBeCloseTo(3.14159, 5);

    // Integer columns should work as float
    reader.setIndex(0);
    expect(reader.getFloat()).toBe(42);

    // BigInt columns should convert to number
    bigintReader.setIndex(0);
    expect(bigintReader.getFloat()).toBe(9007199254740991);
  });
});

describe("NumericColumnAccessor", () => {
  let column: NumericColumn<'int32'>;
  let accessor: NumericColumnAccessor<'int32'>;
  let txnState: TransactionState;

  beforeEach(async () => {
    column = createInt32Column("test");
    await column.set(0, 10);
    await column.set(1, 20);
    await column.set(2, 30);
    await column.set(3, 40);
    await column.set(4, 50);

    txnState = {
      cursor: 0,
      setup: false,
      index: BitmapUtils.fromIndices([0, 2, 4]), // values 10, 30, 50
      dirty: new TypedFastBitSet(),
      columns: new Map()
    };

    accessor = new NumericColumnAccessor(column, txnState);
  });

  test("should get current value", () => {
    txnState.cursor = 2;
    expect(accessor.get()).toBe(30);

    txnState.cursor = 99;
    expect(accessor.get()).toBeUndefined();
  });

  test("should provide column name", () => {
    expect(accessor.name()).toBe("test");
  });

  test("should calculate sum with transaction bitmap", async () => {
    const sum = await accessor.sum();
    expect(sum).toBe(90); // 10 + 30 + 50 from bitmap indices
  });

  test("should calculate average with transaction bitmap", async () => {
    const avg = await accessor.avg();
    expect(avg).toBe(30); // (10 + 30 + 50) / 3
  });

  test("should find min with transaction bitmap", async () => {
    const min = await accessor.min();
    expect(min).toBe(10);
  });

  test("should find max with transaction bitmap", async () => {
    const max = await accessor.max();
    expect(max).toBe(50);
  });
});

describe("NumericColumn edge cases", () => {
  test("should handle mixed numeric operations", async () => {
    const int8Col = createInt8Column("int8");
    const uint64Col = createUint64Column("uint64");

    // Test small values in int8
    await int8Col.set(0, 127);  // max int8
    await int8Col.set(1, -128); // min int8

    // Test large values in uint64
    await uint64Col.set(0, 18446744073709551615n); // max uint64
    await uint64Col.set(1, 0n);

    expect(await int8Col.get(0)).toBe(127);
    expect(await int8Col.get(1)).toBe(-128);
    expect(await uint64Col.get(0)).toBe(18446744073709551615n);
    expect(await uint64Col.get(1)).toBe(0n);
  });

  test("should handle NaN in aggregations", async () => {
    const floatCol = createFloat64Column("float");
    await floatCol.set(0, 10);
    await floatCol.set(1, NaN);
    await floatCol.set(2, 30);

    // Aggregations with NaN should handle gracefully
    const sum = await floatCol.sum();
    const avg = await floatCol.avg();

    // NaN in sum should make result NaN
    expect(Number.isNaN(sum)).toBe(true);
    expect(Number.isNaN(avg)).toBe(true);
  });

  test("should handle Infinity in aggregations", async () => {
    const floatCol = createFloat64Column("float");
    await floatCol.set(0, 10);
    await floatCol.set(1, Infinity);
    await floatCol.set(2, 30);

    const sum = await floatCol.sum();
    const max = await floatCol.max();
    const min = await floatCol.min();

    expect(sum).toBe(Infinity);
    expect(max).toBe(Infinity);
    expect(min).toBe(10);
  });
});
