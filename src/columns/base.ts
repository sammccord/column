import { TypedFastBitSet } from 'typedfastbitset';
import type { 
  ColumnType, 
  ColumnSchema, 
  Reader, 
  Row, 
  Predicate,
  ChunkMetadata,
  TransactionState
} from '../types.js';
import { ChunkManager, ChunkUtils } from '../utils/chunk.js';
import { SimpleMutex } from '../utils/mutex.js';
import { CHUNK_SIZE, ERROR_MESSAGES } from '../constants.js';

/**
 * Base class for all column implementations
 */
export abstract class BaseColumn<T = any> {
  protected readonly name: string;
  protected readonly type: ColumnType;
  protected readonly options: Record<string, any>;
  protected readonly mutex: SimpleMutex;
  protected data: ChunkManager<T>;
  protected fillList: TypedFastBitSet;
  protected isDropped: boolean = false;

  constructor(name: string, type: ColumnType, options: Record<string, any> = {}) {
    this.name = name;
    this.type = type;
    this.options = options;
    this.mutex = new SimpleMutex();
    this.data = new ChunkManager(() => new Array(CHUNK_SIZE));
    this.fillList = new TypedFastBitSet();
  }

  /**
   * Get column schema information
   */
  getSchema(): ColumnSchema {
    return {
      name: this.name,
      type: this.type,
      options: { ...this.options }
    };
  }

  /**
   * Get column name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get column type
   */
  getType(): ColumnType {
    return this.type;
  }

  /**
   * Check if column has been dropped
   */
  isColumnDropped(): boolean {
    return this.isDropped;
  }

  /**
   * Mark column as dropped
   */
  drop(): void {
    this.isDropped = true;
  }

  /**
   * Get the number of non-null values in the column
   */
  size(): number {
    return this.fillList.size();
  }

  /**
   * Get the total capacity (including null values)
   */
  capacity(): number {
    return this.data.getChunkCount() * CHUNK_SIZE;
  }

  /**
   * Check if an index contains a value
   */
  contains(index: number): boolean {
    return this.fillList.has(index);
  }

  /**
   * Get fill list bitmap (which indices contain values)
   */
  getFillList(): TypedFastBitSet {
    return this.fillList.clone();
  }

  /**
   * Set a value at the specified index
   */
  async set(index: number, value: T): Promise<void> {
    if (this.isDropped) {
      throw new Error('Cannot set value on dropped column');
    }

    await this.mutex.withLock(async () => {
      await this.setInternal(index, value);
      this.fillList.add(index);
      this.markChunkDirty(index);
    });
  }

  /**
   * Get a value at the specified index
   */
  async get(index: number): Promise<T | undefined> {
    if (!this.fillList.has(index)) {
      return undefined;
    }

    return this.mutex.withLock(async () => {
      return this.getInternal(index);
    });
  }

  /**
   * Remove a value at the specified index
   */
  async remove(index: number): Promise<void> {
    if (this.isDropped) {
      throw new Error('Cannot remove value from dropped column');
    }

    await this.mutex.withLock(async () => {
      if (this.fillList.has(index)) {
        await this.removeInternal(index);
        this.fillList.remove(index);
        this.markChunkDirty(index);
      }
    });
  }

  /**
   * Filter values based on a predicate
   */
  async filter(predicate: Predicate): Promise<TypedFastBitSet> {
    const result = new TypedFastBitSet();
    const reader = this.createReader();

    await this.mutex.withLock(async () => {
      for (const index of this.fillList) {
        reader.setIndex(index);
        if (predicate(reader)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Apply updates to multiple indices atomically
   */
  async batchUpdate(updates: Array<{ index: number; value: T | undefined }>): Promise<void> {
    if (this.isDropped) {
      throw new Error('Cannot update dropped column');
    }

    await this.mutex.withLock(async () => {
      const dirtyChunks = new Set<number>();

      for (const { index, value } of updates) {
        if (value === undefined) {
          if (this.fillList.has(index)) {
            await this.removeInternal(index);
            this.fillList.remove(index);
            dirtyChunks.add(ChunkUtils.chunkAt(index));
          }
        } else {
          await this.setInternal(index, value);
          this.fillList.add(index);
          dirtyChunks.add(ChunkUtils.chunkAt(index));
        }
      }

      // Mark affected chunks as dirty
      for (const chunkId of dirtyChunks) {
        this.data.getMetadata(chunkId).isDirty = true;
      }
    });
  }

  /**
   * Get memory usage statistics
   */
  getStats(): {
    name: string;
    type: ColumnType;
    size: number;
    capacity: number;
    fillRatio: number;
    memoryUsage: {
      chunks: number;
      estimatedBytes: number;
    };
  } {
    const chunkStats = this.data.getStats();
    
    return {
      name: this.name,
      type: this.type,
      size: this.size(),
      capacity: this.capacity(),
      fillRatio: this.capacity() > 0 ? this.size() / this.capacity() : 0,
      memoryUsage: {
        chunks: chunkStats.chunkCount,
        estimatedBytes: chunkStats.estimatedMemoryBytes
      }
    };
  }

  /**
   * Compact the column by removing unused chunks
   */
  async compact(): Promise<void> {
    await this.mutex.withLock(async () => {
      this.data.compact();
    });
  }

  /**
   * Get dirty chunks for serialization
   */
  getDirtyChunks(): number[] {
    return this.data.getDirtyChunks();
  }

  /**
   * Mark all chunks as clean
   */
  markAllClean(): void {
    this.data.markAllClean();
  }

  /**
   * Mark a specific chunk as clean
   */
  markChunkClean(chunkId: number): void {
    this.data.markClean(chunkId);
  }

  /**
   * Create a column-specific reader for transactions
   */
  createReader(txnState: TransactionState): ColumnReader<T> {
    return new ColumnReader(this, txnState);
  }

  // Abstract methods that must be implemented by subclasses

  /**
   * Internal method to set a value (called with lock held)
   */
  protected abstract setInternal(index: number, value: T): Promise<void>;

  /**
   * Internal method to get a value (called with lock held)
   */
  protected abstract getInternal(index: number): Promise<T | undefined>;

  /**
   * Internal method to remove a value (called with lock held)
   */
  protected abstract removeInternal(index: number): Promise<void>;

  /**
   * Serialize column data to bytes
   */
  abstract serialize(): Promise<Uint8Array>;

  /**
   * Deserialize column data from bytes
   */
  abstract deserialize(data: Uint8Array): Promise<void>;

  /**
   * Create a copy of this column
   */
  abstract clone(): BaseColumn<T>;

  /**
   * Mark a chunk as dirty
   */
  private markChunkDirty(index: number): void {
    const chunkId = ChunkUtils.chunkAt(index);
    this.data.getMetadata(chunkId).isDirty = true;
  }
}

/**
 * Column reader implementation for transaction support
 */
export class ColumnReader<T = any> implements Reader {
  private column: BaseColumn<T>;
  private currentIndex: number = 0;
  private txnState?: TransactionState;

  constructor(column: BaseColumn<T>, txnState?: TransactionState) {
    this.column = column;
    this.txnState = txnState;
  }

  setIndex(index: number): void {
    this.currentIndex = index;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getString(): string | undefined {
    // This will be overridden by string column readers
    throw new Error('getString not supported for this column type');
  }

  getInt(): number | undefined {
    // This will be overridden by numeric column readers
    throw new Error('getInt not supported for this column type');
  }

  getBigInt(): bigint | undefined {
    // This will be overridden by bigint column readers
    throw new Error('getBigInt not supported for this column type');
  }

  getFloat(): number | undefined {
    // This will be overridden by float column readers
    throw new Error('getFloat not supported for this column type');
  }

  getBoolean(): boolean | undefined {
    // This will be overridden by boolean column readers
    throw new Error('getBoolean not supported for this column type');
  }

  getRecord<R>(): R | undefined {
    // This will be overridden by record column readers
    throw new Error('getRecord not supported for this column type');
  }

  /**
   * Get raw value (for internal use)
   */
  async getRaw(): Promise<T | undefined> {
    return this.column.get(this.currentIndex);
  }
}

/**
 * Column registry for managing all columns in a collection
 */
export class ColumnRegistry {
  private columns = new Map<string, BaseColumn>();
  private mutex = new SimpleMutex();

  /**
   * Register a new column
   */
  async register(column: BaseColumn): Promise<void> {
    await this.mutex.withLock(async () => {
      const name = column.getName();
      
      if (this.columns.has(name)) {
        throw new Error(ERROR_MESSAGES.COLUMN_EXISTS(name));
      }
      
      this.columns.set(name, column);
    });
  }

  /**
   * Get a column by name
   */
  get(name: string): BaseColumn | undefined {
    return this.columns.get(name);
  }

  /**
   * Get a column by name (throws if not found)
   */
  getRequired(name: string): BaseColumn {
    const column = this.columns.get(name);
    if (!column) {
      throw new Error(ERROR_MESSAGES.COLUMN_NOT_FOUND(name));
    }
    if (column.isColumnDropped()) {
      throw new Error(`Column '${name}' has been dropped`);
    }
    return column;
  }

  /**
   * Check if a column exists
   */
  has(name: string): boolean {
    return this.columns.has(name) && !this.columns.get(name)!.isColumnDropped();
  }

  /**
   * Remove a column
   */
  async drop(name: string): Promise<boolean> {
    return this.mutex.withLock(async () => {
      const column = this.columns.get(name);
      if (!column) {
        return false;
      }
      
      column.drop();
      this.columns.delete(name);
      return true;
    });
  }

  /**
   * Get all column names
   */
  getNames(): string[] {
    return Array.from(this.columns.keys()).filter(name => 
      !this.columns.get(name)!.isColumnDropped()
    );
  }

  /**
   * Get all columns
   */
  getAll(): BaseColumn[] {
    return Array.from(this.columns.values()).filter(column => 
      !column.isColumnDropped()
    );
  }

  /**
   * Get column schemas
   */
  getSchemas(): ColumnSchema[] {
    return this.getAll().map(column => column.getSchema());
  }

  /**
   * Clear all columns
   */
  async clear(): Promise<void> {
    await this.mutex.withLock(async () => {
      for (const column of this.columns.values()) {
        column.drop();
      }
      this.columns.clear();
    });
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    columnCount: number;
    totalSize: number;
    totalCapacity: number;
    columns: Array<ReturnType<BaseColumn['getStats']>>;
  } {
    const activeColumns = this.getAll();
    const columnStats = activeColumns.map(col => col.getStats());
    
    return {
      columnCount: activeColumns.length,
      totalSize: columnStats.reduce((sum, stats) => sum + stats.size, 0),
      totalCapacity: columnStats.reduce((sum, stats) => sum + stats.capacity, 0),
      columns: columnStats
    };
  }
}