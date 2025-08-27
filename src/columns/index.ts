import type { Predicate, Reader } from '../types.js';
import { createIndexColumn } from './bitmap-index.js';
import { createBooleanColumn } from './boolean.js';
import { createKeyColumn } from './key.js';
import { createFloat32Column, createFloat64Column, createInt8Column, createInt16Column, createInt32Column, createInt64Column, createUint8Column, createUint16Column, createUint32Column, createUint64Column } from './numeric.js';
import { createRecordColumn } from './record.js';
import { createSortIndexColumn, SortIndexUtils } from './sort-index.js';
import { createEnumColumn, createStringColumn } from './string.js';

// Base column infrastructure
export {
  BaseColumn,
  ColumnReader,
  ColumnRegistry
} from './base.js';

// Numeric columns
export {
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
} from './numeric.js';

// String and enum columns
export {
  StringColumn,
  EnumColumn,
  StringColumnReader,
  EnumColumnReader,
  StringColumnAccessor,
  EnumColumnAccessor,
  createStringColumn,
  createEnumColumn
} from './string.js';

// Boolean columns
export {
  BooleanColumn,
  BooleanColumnReader,
  BooleanColumnAccessor,
  createBooleanColumn
} from './boolean.js';

// Record columns
export {
  RecordColumn,
  RecordColumnReader,
  RecordColumnAccessor,
  createRecordColumn,
  type Marshaler,
  type Unmarshaler,
  type JSONMarshaler
} from './record.js';

// Primary key columns
export {
  KeyColumn,
  KeyColumnReader,
  KeyColumnUtils,
  createKeyColumn
} from './key.js';

// Bitmap index columns
export {
  IndexColumn,
  IndexColumnReader,
  IndexManager,
  createIndexColumn
} from './bitmap-index.js';

// Sorted index columns
export {
  SortIndexColumn,
  SortIndexColumnReader,
  SortIndexUtils,
  createSortIndexColumn
} from './sort-index.js';

// Re-export commonly used types
export type {
  ColumnSchema,
  ColumnType,
  NumericType,
  NumericValue,
  Reader,
  Row,
  Predicate,
  StringAccessor,
  NumericAccessor,
  BooleanAccessor,
  RecordAccessor,
  TransactionState
} from '../types.js';

/**
 * Column factory functions for easy column creation
 */
export class ColumnFactory {
  // Numeric columns
  static int8(name: string, options?: Record<string, any>) {
    return createInt8Column(name, options);
  }

  static int16(name: string, options?: Record<string, any>) {
    return createInt16Column(name, options);
  }

  static int32(name: string, options?: Record<string, any>) {
    return createInt32Column(name, options);
  }

  static int64(name: string, options?: Record<string, any>) {
    return createInt64Column(name, options);
  }

  static uint8(name: string, options?: Record<string, any>) {
    return createUint8Column(name, options);
  }

  static uint16(name: string, options?: Record<string, any>) {
    return createUint16Column(name, options);
  }

  static uint32(name: string, options?: Record<string, any>) {
    return createUint32Column(name, options);
  }

  static uint64(name: string, options?: Record<string, any>) {
    return createUint64Column(name, options);
  }

  static float32(name: string, options?: Record<string, any>) {
    return createFloat32Column(name, options);
  }

  static float64(name: string, options?: Record<string, any>) {
    return createFloat64Column(name, options);
  }

  // String columns
  static string(name: string, options?: Record<string, any>) {
    return createStringColumn(name, options);
  }

  static enum(name: string, options?: Record<string, any>) {
    return createEnumColumn(name, options);
  }

  // Boolean columns
  static boolean(name: string, options?: Record<string, any>) {
    return createBooleanColumn(name, options);
  }

  // Record columns
  static record<T = any>(name: string, options?: {
    marshaler?: (value: T) => Uint8Array;
    unmarshaler?: (data: Uint8Array) => T;
    [key: string]: any;
  }) {
    return createRecordColumn<T>(name, options);
  }

  // Key columns
  static key(name: string, options?: { unique?: boolean; [key: string]: any }) {
    return createKeyColumn(name, options);
  }

  // Index columns
  static index(
    name: string,
    targetColumn: string,
    predicate: Predicate,
    options?: Record<string, any>
  ) {
    return createIndexColumn(name, targetColumn, predicate, options);
  }

  // Sort index columns
  static sortIndex(
    name: string,
    targetColumn: string,
    keyExtractor: (reader: Reader) => string,
    options?: Record<string, any>
  ) {
    return createSortIndexColumn(name, targetColumn, keyExtractor, options);
  }

  // Convenient sort index creators
  static stringSortIndex(name: string, targetColumn: string) {
    return SortIndexUtils.createStringIndex(name, targetColumn);
  }

  static numericSortIndex(name: string, targetColumn: string) {
    return SortIndexUtils.createNumericIndex(name, targetColumn);
  }

  static dateSortIndex(name: string, targetColumn: string) {
    return SortIndexUtils.createDateIndex(name, targetColumn);
  }

  static recordFieldSortIndex(
    name: string,
    targetColumn: string,
    fieldPath: string
  ) {
    return SortIndexUtils.createRecordFieldIndex(name, targetColumn, fieldPath);
  }
}

/**
 * Type-safe column creation helpers
 */
export const Column = {
  // Numeric types
  Int8: ColumnFactory.int8,
  Int16: ColumnFactory.int16,
  Int32: ColumnFactory.int32,
  Int64: ColumnFactory.int64,
  UInt8: ColumnFactory.uint8,
  UInt16: ColumnFactory.uint16,
  UInt32: ColumnFactory.uint32,
  UInt64: ColumnFactory.uint64,
  Float32: ColumnFactory.float32,
  Float64: ColumnFactory.float64,

  // Other types
  String: ColumnFactory.string,
  Enum: ColumnFactory.enum,
  Boolean: ColumnFactory.boolean,
  Record: ColumnFactory.record,
  Key: ColumnFactory.key,

  // Indexes
  Index: ColumnFactory.index,
  SortIndex: ColumnFactory.sortIndex,
  StringSortIndex: ColumnFactory.stringSortIndex,
  NumericSortIndex: ColumnFactory.numericSortIndex,
  DateSortIndex: ColumnFactory.dateSortIndex,
  RecordFieldSortIndex: ColumnFactory.recordFieldSortIndex,
} as const;

/**
 * Predicate helpers for creating common index predicates
 */
export const Predicates = {
  /**
   * Create a predicate that checks if a numeric value is greater than threshold
   */
  greaterThan: (threshold: number) => (reader: Reader) => {
    const value = reader.getInt() || reader.getFloat();
    return value !== undefined && value > threshold;
  },

  /**
   * Create a predicate that checks if a numeric value is less than threshold
   */
  lessThan: (threshold: number) => (reader: Reader) => {
    const value = reader.getInt() || reader.getFloat();
    return value !== undefined && value < threshold;
  },

  /**
   * Create a predicate that checks if a numeric value is within a range
   */
  between: (min: number, max: number) => (reader: Reader) => {
    const value = reader.getInt() || reader.getFloat();
    return value !== undefined && value >= min && value <= max;
  },

  /**
   * Create a predicate that checks if a string starts with a prefix
   */
  startsWith: (prefix: string) => (reader: Reader) => {
    const value = reader.getString();
    return value !== undefined && value.startsWith(prefix);
  },

  /**
   * Create a predicate that checks if a string ends with a suffix
   */
  endsWith: (suffix: string) => (reader: Reader) => {
    const value = reader.getString();
    return value !== undefined && value.endsWith(suffix);
  },

  /**
   * Create a predicate that checks if a string contains a substring
   */
  contains: (substring: string) => (reader: Reader) => {
    const value = reader.getString();
    return value !== undefined && value.includes(substring);
  },

  /**
   * Create a predicate that checks if a string matches a regex
   */
  matches: (pattern: RegExp) => (reader: Reader) => {
    const value = reader.getString();
    return value !== undefined && pattern.test(value);
  },

  /**
   * Create a predicate that checks if a boolean value is true
   */
  isTrue: (reader: Reader) => {
    return reader.getBoolean() === true;
  },

  /**
   * Create a predicate that checks if a boolean value is false
   */
  isFalse: (reader: Reader) => {
    return reader.getBoolean() === false;
  },

  /**
   * Create a predicate that checks if a record has a specific property value
   */
  recordHasProperty: <T>(property: string, value: T) => (reader: Reader) => {
    const record = reader.getRecord<any>();
    return record && record[property] === value;
  },

  /**
   * Create a predicate that checks if a value is null/undefined
   */
  isNull: (reader: Reader) => {
    try {
      return (
        reader.getString() === undefined &&
        reader.getInt() === undefined &&
        reader.getFloat() === undefined &&
        reader.getBoolean() === undefined &&
        reader.getRecord() === undefined
      );
    } catch {
      return true;
    }
  },

  /**
   * Create a predicate that checks if a value is not null/undefined
   */
  isNotNull: (reader: Reader) => {
    return !Predicates.isNull(reader);
  },

  /**
   * Combine multiple predicates with AND logic
   */
  and: (...predicates: Predicate[]) => (reader: Reader) => {
    return predicates.every(predicate => predicate(reader));
  },

  /**
   * Combine multiple predicates with OR logic
   */
  or: (...predicates: Predicate[]) => (reader: Reader) => {
    return predicates.some(predicate => predicate(reader));
  },

  /**
   * Negate a predicate
   */
  not: (predicate: Predicate) => (reader: Reader) => {
    return !predicate(reader);
  }
} as const;
