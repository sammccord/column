import { describe, test, expect } from "bun:test";
import {
  CHUNK_SIZE,
  SHARD_COUNT,
  INITIAL_CAPACITY,
  GROWTH_FACTOR,
  FORMAT_VERSION,
  MAGIC_HEADER,
  COMPRESSION_THRESHOLD,
  HASH_SEED,
  INDEX_LOAD_FACTOR,
  ENUM_INITIAL_SIZE,
  MAX_TRANSACTION_DEPTH,
  LOCK_TIMEOUT_MS,
  POOL_SIZE,
  COLUMN_TYPE_CODES,
  NUMERIC_TYPE_INFO,
  ERROR_MESSAGES,
  PERFORMANCE,
  FEATURES
} from "../src/constants.js";

describe("Constants", () => {
  describe("Core Constants", () => {
    test("CHUNK_SIZE should be 16384", () => {
      expect(CHUNK_SIZE).toBe(16384);
    });

    test("SHARD_COUNT should be 128", () => {
      expect(SHARD_COUNT).toBe(128);
    });

    test("INITIAL_CAPACITY should be positive", () => {
      expect(INITIAL_CAPACITY).toBeGreaterThan(0);
      expect(INITIAL_CAPACITY).toBe(1024);
    });

    test("GROWTH_FACTOR should be greater than 1", () => {
      expect(GROWTH_FACTOR).toBeGreaterThan(1);
      expect(GROWTH_FACTOR).toBe(1.5);
    });
  });

  describe("Serialization Constants", () => {
    test("FORMAT_VERSION should be positive integer", () => {
      expect(FORMAT_VERSION).toBe(1);
      expect(Number.isInteger(FORMAT_VERSION)).toBe(true);
    });

    test("MAGIC_HEADER should be valid hex value", () => {
      expect(MAGIC_HEADER).toBe(0x434F4C554D);
      expect(typeof MAGIC_HEADER).toBe("number");
    });

    test("COMPRESSION_THRESHOLD should be positive", () => {
      expect(COMPRESSION_THRESHOLD).toBeGreaterThan(0);
      expect(COMPRESSION_THRESHOLD).toBe(1024);
    });
  });

  describe("Hash Constants", () => {
    test("HASH_SEED should be valid", () => {
      expect(HASH_SEED).toBe(0x9e3779b9);
      expect(typeof HASH_SEED).toBe("number");
    });

    test("INDEX_LOAD_FACTOR should be between 0 and 1", () => {
      expect(INDEX_LOAD_FACTOR).toBeGreaterThan(0);
      expect(INDEX_LOAD_FACTOR).toBeLessThanOrEqual(1);
      expect(INDEX_LOAD_FACTOR).toBe(0.75);
    });
  });

  describe("Column Type Codes", () => {
    test("should have all numeric type codes", () => {
      expect(COLUMN_TYPE_CODES.INT8).toBe(0x01);
      expect(COLUMN_TYPE_CODES.INT16).toBe(0x02);
      expect(COLUMN_TYPE_CODES.INT32).toBe(0x03);
      expect(COLUMN_TYPE_CODES.INT64).toBe(0x04);
      expect(COLUMN_TYPE_CODES.UINT8).toBe(0x05);
      expect(COLUMN_TYPE_CODES.UINT16).toBe(0x06);
      expect(COLUMN_TYPE_CODES.UINT32).toBe(0x07);
      expect(COLUMN_TYPE_CODES.UINT64).toBe(0x08);
      expect(COLUMN_TYPE_CODES.FLOAT32).toBe(0x09);
      expect(COLUMN_TYPE_CODES.FLOAT64).toBe(0x0A);
    });

    test("should have all other type codes", () => {
      expect(COLUMN_TYPE_CODES.STRING).toBe(0x0B);
      expect(COLUMN_TYPE_CODES.ENUM).toBe(0x0C);
      expect(COLUMN_TYPE_CODES.BOOLEAN).toBe(0x0D);
      expect(COLUMN_TYPE_CODES.RECORD).toBe(0x0E);
      expect(COLUMN_TYPE_CODES.KEY).toBe(0x0F);
      expect(COLUMN_TYPE_CODES.INDEX).toBe(0x10);
      expect(COLUMN_TYPE_CODES.SORT_INDEX).toBe(0x11);
    });

    test("all type codes should be unique", () => {
      const codes = Object.values(COLUMN_TYPE_CODES);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });
  });

  describe("Numeric Type Info", () => {
    test("should have correct byte sizes", () => {
      expect(NUMERIC_TYPE_INFO.int8.byteSize).toBe(1);
      expect(NUMERIC_TYPE_INFO.int16.byteSize).toBe(2);
      expect(NUMERIC_TYPE_INFO.int32.byteSize).toBe(4);
      expect(NUMERIC_TYPE_INFO.int64.byteSize).toBe(8);
      expect(NUMERIC_TYPE_INFO.float32.byteSize).toBe(4);
      expect(NUMERIC_TYPE_INFO.float64.byteSize).toBe(8);
    });

    test("should have correct signed flags", () => {
      expect(NUMERIC_TYPE_INFO.int8.signed).toBe(true);
      expect(NUMERIC_TYPE_INFO.uint8.signed).toBe(false);
      expect(NUMERIC_TYPE_INFO.int32.signed).toBe(true);
      expect(NUMERIC_TYPE_INFO.uint32.signed).toBe(false);
    });

    test("should have correct float flags", () => {
      expect(NUMERIC_TYPE_INFO.int32.isFloat).toBe(false);
      expect(NUMERIC_TYPE_INFO.float32.isFloat).toBe(true);
      expect(NUMERIC_TYPE_INFO.float64.isFloat).toBe(true);
    });

    test("should have correct array types", () => {
      expect(NUMERIC_TYPE_INFO.int8.arrayType).toBe(Int8Array);
      expect(NUMERIC_TYPE_INFO.uint8.arrayType).toBe(Uint8Array);
      expect(NUMERIC_TYPE_INFO.int32.arrayType).toBe(Int32Array);
      expect(NUMERIC_TYPE_INFO.float32.arrayType).toBe(Float32Array);
      expect(NUMERIC_TYPE_INFO.float64.arrayType).toBe(Float64Array);
    });
  });

  describe("Error Messages", () => {
    test("should generate correct error messages", () => {
      expect(ERROR_MESSAGES.COLUMN_NOT_FOUND("test")).toBe("Column 'test' not found");
      expect(ERROR_MESSAGES.COLUMN_EXISTS("test")).toBe("Column 'test' already exists");
      expect(ERROR_MESSAGES.INVALID_COLUMN_TYPE("invalid")).toBe("Invalid column type: invalid");
      expect(ERROR_MESSAGES.INCOMPATIBLE_TYPE("string", "number")).toBe("Type mismatch: expected string, got number");
    });

    test("should have all required error message functions", () => {
      expect(typeof ERROR_MESSAGES.COLUMN_NOT_FOUND).toBe("function");
      expect(typeof ERROR_MESSAGES.COLUMN_EXISTS).toBe("function");
      expect(typeof ERROR_MESSAGES.INDEX_NOT_FOUND).toBe("function");
      expect(typeof ERROR_MESSAGES.INDEX_EXISTS).toBe("function");
      expect(typeof ERROR_MESSAGES.INVALID_COLUMN_TYPE).toBe("function");
      expect(typeof ERROR_MESSAGES.INVALID_INDEX).toBe("function");
      expect(typeof ERROR_MESSAGES.INCOMPATIBLE_TYPE).toBe("function");
      expect(typeof ERROR_MESSAGES.CHUNK_OUT_OF_BOUNDS).toBe("function");
    });
  });

  describe("Performance Constants", () => {
    test("should have valid performance settings", () => {
      expect(PERFORMANCE.SIMD_BATCH_SIZE).toBeGreaterThan(0);
      expect(PERFORMANCE.BITMAP_DENSE_THRESHOLD).toBeGreaterThan(0);
      expect(PERFORMANCE.BITMAP_DENSE_THRESHOLD).toBeLessThanOrEqual(1);
      expect(PERFORMANCE.STRING_INTERN_THRESHOLD).toBeGreaterThan(0);
      expect(PERFORMANCE.AGG_BUFFER_SIZE).toBeGreaterThan(0);
    });

    test("buffer sizes should be powers of 2 or reasonable values", () => {
      expect(PERFORMANCE.SMALL_BUFFER_SIZE).toBe(256);
      expect(PERFORMANCE.MEDIUM_BUFFER_SIZE).toBe(1024);
      expect(PERFORMANCE.LARGE_BUFFER_SIZE).toBe(4096);
    });
  });

  describe("Feature Flags", () => {
    test("should have boolean feature flags", () => {
      expect(typeof FEATURES.ENABLE_SIMD).toBe("boolean");
      expect(typeof FEATURES.ENABLE_COMPRESSION).toBe("boolean");
      expect(typeof FEATURES.ENABLE_CDC).toBe("boolean");
      expect(typeof FEATURES.ENABLE_STATISTICS).toBe("boolean");
      expect(typeof FEATURES.ENABLE_PROFILING).toBe("boolean");
    });

    test("should have reasonable default values", () => {
      expect(FEATURES.ENABLE_SIMD).toBe(true);
      expect(FEATURES.ENABLE_COMPRESSION).toBe(true);
      expect(FEATURES.ENABLE_STATISTICS).toBe(true);
    });
  });

  describe("Transaction Constants", () => {
    test("should have valid transaction settings", () => {
      expect(MAX_TRANSACTION_DEPTH).toBeGreaterThan(0);
      expect(LOCK_TIMEOUT_MS).toBeGreaterThan(0);
      expect(POOL_SIZE).toBeGreaterThan(0);
    });

    test("should have reasonable timeout values", () => {
      expect(LOCK_TIMEOUT_MS).toBe(5000);
      expect(LOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    });
  });
});