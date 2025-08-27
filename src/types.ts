import type { TypedFastBitSet } from 'typedfastbitset';
import type BTree from 'sorted-btree';

// Core numeric types supported by the column store
export type NumericType = 
  | 'int8' | 'int16' | 'int32' | 'int64'
  | 'uint8' | 'uint16' | 'uint32' | 'uint64'
  | 'float32' | 'float64';

export type ColumnType = 
  | NumericType 
  | 'string' | 'enum' | 'boolean' | 'record' | 'key' | 'index' | 'sort-index';

// TypeScript types for numeric values
export type NumericValue<T extends NumericType> = T extends 'float32' | 'float64' ? number :
  T extends 'int64' | 'uint64' ? bigint : number;

// Base column data types
export interface ColumnSchema {
  readonly name: string;
  readonly type: ColumnType;
  readonly options?: Record<string, any>;
}

// Reader interface for accessing column values
export interface Reader {
  getString(): string | undefined;
  getInt(): number | undefined;
  getBigInt(): bigint | undefined;
  getFloat(): number | undefined;
  getBoolean(): boolean | undefined;
  getRecord<T>(): T | undefined;
}

// Row interface for setting column values
export interface Row {
  setString(column: string, value: string): void;
  setInt(column: string, value: number): void;
  setBigInt(column: string, value: bigint): void;
  setFloat(column: string, value: number): void;
  setBoolean(column: string, value: boolean): void;
  setRecord<T>(column: string, value: T): void;
}

// Predicate function for filtering
export type Predicate = (reader: Reader) => boolean;

// Transaction callback types
export type InsertCallback = (row: Row) => void | Promise<void>;
export type QueryCallback = (txn: Transaction) => void | Promise<void>;
export type RangeCallback = (index: number) => boolean | void;

// Column accessor interfaces
export interface StringAccessor {
  get(): string | undefined;
  name(): string;
}

export interface NumericAccessor<T extends NumericType> {
  get(): NumericValue<T> | undefined;
  sum(): NumericValue<T>;
  avg(): number;
  min(): NumericValue<T> | undefined;
  max(): NumericValue<T> | undefined;
  name(): string;
}

export interface BooleanAccessor {
  get(): boolean | undefined;
  name(): string;
}

export interface RecordAccessor<T> {
  get(): T | undefined;
  name(): string;
}

// Transaction interface
export interface Transaction {
  // Column accessors
  string(column: string): StringAccessor;
  int8(column: string): NumericAccessor<'int8'>;
  int16(column: string): NumericAccessor<'int16'>;
  int32(column: string): NumericAccessor<'int32'>;
  int64(column: string): NumericAccessor<'int64'>;
  uint8(column: string): NumericAccessor<'uint8'>;
  uint16(column: string): NumericAccessor<'uint16'>;
  uint32(column: string): NumericAccessor<'uint32'>;
  uint64(column: string): NumericAccessor<'uint64'>;
  float32(column: string): NumericAccessor<'float32'>;
  float64(column: string): NumericAccessor<'float64'>;
  boolean(column: string): BooleanAccessor;
  record<T>(column: string): RecordAccessor<T>;

  // Filtering operations
  with(...indexes: string[]): Transaction;
  union(...indexes: string[]): Transaction;
  without(...indexes: string[]): Transaction;
  withValue(column: string, predicate: Predicate): Transaction;

  // Iteration
  range(callback: RangeCallback): void;
  count(): number;
}

// Collection options
export interface CollectionOptions {
  capacity?: number;
  chunkSize?: number;
  logger?: CommitLogger;
  enableCdc?: boolean;
}

// Commit logging for CDC (Change Data Capture)
export interface CommitLogger {
  log(operation: CommitOperation): void;
}

export interface CommitOperation {
  type: 'insert' | 'update' | 'delete';
  index: number;
  key?: string;
  data?: Record<string, any>;
  timestamp: number;
}

// Index creation options
export interface IndexOptions {
  predicate?: Predicate;
  unique?: boolean;
}

// Serialization format
export interface SerializationHeader {
  version: number;
  chunkSize: number;
  columnCount: number;
  rowCount: number;
  compressed: boolean;
}

// Internal chunk management
export const CHUNK_SIZE = 16384; // 16K elements per chunk
export const SHARD_COUNT = 128;  // Number of mutex shards

// Error types
export class ColumnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColumnError';
  }
}

export class SchemaError extends ColumnError {
  constructor(message: string) {
    super(`Schema error: ${message}`);
    this.name = 'SchemaError';
  }
}

export class IndexError extends ColumnError {
  constructor(message: string) {
    super(`Index error: ${message}`);
    this.name = 'IndexError';
  }
}

export class TransactionError extends ColumnError {
  constructor(message: string) {
    super(`Transaction error: ${message}`);
    this.name = 'TransactionError';
  }
}

// Utility types for better type safety
export type ExtractColumnType<T> = T extends { type: infer U } ? U : never;
export type InferValueType<T extends ColumnType> = 
  T extends NumericType ? NumericValue<T> :
  T extends 'string' | 'enum' ? string :
  T extends 'boolean' ? boolean :
  T extends 'record' ? any :
  unknown;

// Internal interfaces (used by implementation)
export interface ChunkMetadata {
  id: number;
  startIndex: number;
  endIndex: number;
  isDirty: boolean;
  commitId: bigint;
}

export interface ColumnData<T = any> {
  chunks: T[][];
  bitmap: TypedFastBitSet;
  metadata: ChunkMetadata[];
}

export interface SortIndexItem {
  key: string;
  value: number;
}

export interface TransactionState {
  cursor: number;
  setup: boolean;
  index: TypedFastBitSet;
  dirty: TypedFastBitSet;
  columns: Map<string, any>;
}