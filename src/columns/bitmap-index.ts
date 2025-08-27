import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type {
  Reader,
  TransactionState,
  Predicate
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { CHUNK_SIZE, COLUMN_TYPE_CODES } from '../constants.js';

/**
 * Interface for bitmap index entries
 */
export interface IndexEntry {
  value: any;
  bitmap: TypedFastBitSet;
}

/**
 * Bitmap index column implementation for fast filtering based on predicates
 * Maintains bitmap indexes for efficient querying
 */
export class IndexColumn extends BaseColumn<IndexEntry> {
  private readonly targetColumnName: string;
  private readonly predicate: Predicate;
  private readonly indexMap: Map<string, TypedFastBitSet>;
  private readonly reverseMap: Map<number, Set<string>>;

  constructor(
    name: string,
    targetColumn: string,
    predicate: Predicate,
    options: Record<string, any> = {}
  ) {
    super(name, 'index', options);
    this.targetColumnName = targetColumn;
    this.predicate = predicate;
    this.indexMap = new Map();
    this.reverseMap = new Map();
  }

  protected async setInternal(index: number, value: IndexEntry): Promise<void> {
    // Remove old data mappings if updating
    const oldEntry = this.data.get(index);
    if (oldEntry) {
      const oldKey = this.createIndexKey(oldEntry.value);
      const oldBitmap = this.indexMap.get(oldKey);
      if (oldBitmap) {
        // Remove the old entry's bitmap from the index
        for (const oldIndex of oldEntry.bitmap) {
          oldBitmap.remove(oldIndex);
        }
        if (oldBitmap.isEmpty()) {
          this.indexMap.delete(oldKey);
        }
      }
    }

    this.data.set(index, value);

    // Create index key from value
    const indexKey = this.createIndexKey(value.value);

    // Update bitmap for this key - use the bitmap from the IndexEntry
    let bitmap = this.indexMap.get(indexKey);
    if (!bitmap) {
      bitmap = new TypedFastBitSet();
      this.indexMap.set(indexKey, bitmap);
    }

    // Merge the entry's bitmap into our index bitmap
    bitmap = BitmapUtils.or(bitmap, value.bitmap);

    // Update the map with the new bitmap
    this.indexMap.set(indexKey, bitmap);
  }

  protected async getInternal(index: number): Promise<IndexEntry | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    // Remove the entry's bitmap from index mappings
    const entry = this.data.get(index);
    if (entry) {
      const indexKey = this.createIndexKey(entry.value);
      const bitmap = this.indexMap.get(indexKey);
      if (bitmap) {
        // Remove the entry's bitmap indices from the index
        for (const bitmapIndex of entry.bitmap) {
          bitmap.remove(bitmapIndex);
        }
        if (bitmap.isEmpty()) {
          this.indexMap.delete(indexKey);
        }
      }
    }

    this.data.set(index, undefined as any);
  }

  /**
   * Get the target column name this index is built for
   */
  getTargetColumn(): string {
    return this.targetColumnName;
  }

  /**
   * Get the predicate this index uses
   */
  getPredicate(): Predicate {
    return this.predicate;
  }

  /**
   * Find all indices that match a given value
   */
  findIndices(value: any): TypedFastBitSet {
    const indexKey = this.createIndexKey(value);
    return this.indexMap.get(indexKey)?.clone() || new TypedFastBitSet();
  }

  /**
   * Filter indices using the index predicate
   */
  async filterByPredicate(reader: Reader, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const result = new TypedFastBitSet();

    if (!bitmap) {
      throw new Error('filterByPredicate requires a bitmap parameter to specify which indices to check');
    }

    const targetBitmap = bitmap;

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        reader.setIndex(index);
        if (this.predicate(reader)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Get all indexed values
   */
  getIndexedValues(): any[] {
    return Array.from(this.indexMap.keys()).map(key => this.parseIndexKey(key));
  }

  /**
   * Get statistics about the index
   */
  getIndexStats(): {
    indexedValues: number;
    totalMappings: number;
    averageBitmapSize: number;
    memoryUsage: {
      bitmaps: number;
      mappings: number;
      estimatedBytes: number;
    };
  } {
    let totalBitmapSize = 0;
    let bitmapCount = 0;

    for (const bitmap of this.indexMap.values()) {
      totalBitmapSize += bitmap.size();
      bitmapCount++;
    }

    const estimatedBitmapBytes = bitmapCount * 100; // Rough estimate
    const estimatedMappingBytes = this.indexMap.size * 50; // Rough estimate

    return {
      indexedValues: this.indexMap.size,
      totalMappings: totalBitmapSize,
      averageBitmapSize: bitmapCount > 0 ? totalBitmapSize / bitmapCount : 0,
      memoryUsage: {
        bitmaps: bitmapCount,
        mappings: this.indexMap.size,
        estimatedBytes: estimatedBitmapBytes + estimatedMappingBytes
      }
    };
  }

  /**
   * Rebuild the entire index from scratch
   */
  async rebuildIndex(reader: Reader): Promise<void> {
    await this.mutex.withLock(async () => {
      // Clear existing index
      this.indexMap.clear();
      this.reverseMap.clear();

      // Rebuild from fill list
      for (const index of this.fillList) {
        reader.setIndex(index);
        if (this.predicate(reader)) {
          const value = this.extractValue(reader);
          const entry: IndexEntry = { value, bitmap: new TypedFastBitSet([index]) };
          await this.setInternal(index, entry);
        }
      }
    });
  }

  /**
   * Merge this index with another compatible index
   */
  async mergeWith(other: IndexColumn): Promise<void> {
    if (this.targetColumnName !== other.targetColumnName) {
      throw new Error('Cannot merge indexes for different target columns');
    }

    await this.mutex.withLock(async () => {
      // Merge index maps
      for (const [key, bitmap] of other.indexMap.entries()) {
        const existing = this.indexMap.get(key);
        if (existing) {
          const merged = BitmapUtils.or(existing, bitmap);
          this.indexMap.set(key, merged);
        } else {
          this.indexMap.set(key, bitmap.clone());
        }
      }

      // Merge reverse maps
      for (const [index, keys] of other.reverseMap.entries()) {
        const existing = this.reverseMap.get(index);
        if (existing) {
          for (const key of keys) {
            existing.add(key);
          }
        } else {
          this.reverseMap.set(index, new Set(keys));
        }
      }

      // Merge fill lists and data
      this.fillList = BitmapUtils.or(this.fillList, other.fillList);

      for (const index of other.fillList) {
        const value = other.data.get(index);
        if (value) {
          this.data.set(index, value);
        }
      }
    });
  }

  async serialize(): Promise<Uint8Array> {
    const fillListBytes = BitmapUtils.serialize(this.fillList);
    const encoder = new TextEncoder();

    // Serialize index mappings
    const mappings = Array.from(this.indexMap.entries());
    let mappingSize = 4; // mapping count

    for (const [key, bitmap] of mappings) {
      const keyBytes = encoder.encode(key);
      const bitmapBytes = BitmapUtils.serialize(bitmap);
      mappingSize += 4 + keyBytes.length + 4 + bitmapBytes.length;
    }

    // Serialize target column name and predicate info
    const targetBytes = encoder.encode(this.targetColumnName);
    const predicateBytes = encoder.encode(this.predicate.toString());

    // Calculate total size
    const totalSize = 4 + 1 + // version + type
                     4 + targetBytes.length + // target column
                     4 + predicateBytes.length + // predicate
                     4 + fillListBytes.length + // fill list
                     mappingSize;

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;

    view.setUint8(offset, COLUMN_TYPE_CODES.INDEX);
    offset += 1;

    // Write target column
    view.setUint32(offset, targetBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, targetBytes.length).set(targetBytes);
    offset += targetBytes.length;

    // Write predicate
    view.setUint32(offset, predicateBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, predicateBytes.length).set(predicateBytes);
    offset += predicateBytes.length;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write index mappings
    view.setUint32(offset, mappings.length, true);
    offset += 4;

    for (const [key, bitmap] of mappings) {
      const keyBytes = encoder.encode(key);
      const bitmapBytes = BitmapUtils.serialize(bitmap);

      // Write key
      view.setUint32(offset, keyBytes.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, keyBytes.length).set(keyBytes);
      offset += keyBytes.length;

      // Write bitmap
      view.setUint32(offset, bitmapBytes.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, bitmapBytes.length).set(bitmapBytes);
      offset += bitmapBytes.length;
    }

    return new Uint8Array(buffer);
  }

  async deserialize(data: Uint8Array): Promise<void> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;

    // Read header
    const version = view.getUint32(offset, true);
    offset += 4;

    if (version !== 1) {
      throw new Error(`Unsupported index column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;

    if (typeCode !== COLUMN_TYPE_CODES.INDEX) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.INDEX}, got ${typeCode}`);
    }

    // Read target column
    const targetLength = view.getUint32(offset, true);
    offset += 4;
    const targetBytes = new Uint8Array(data.buffer, data.byteOffset + offset, targetLength);
    const targetColumn = decoder.decode(targetBytes);
    offset += targetLength;

    // Read predicate (stored as string, needs to be reconstructed)
    const predicateLength = view.getUint32(offset, true);
    offset += 4;
    offset += predicateLength; // Skip predicate for now

    // Read fill list
    const fillListLength = view.getUint32(offset, true);
    offset += 4;
    const fillListBytes = new Uint8Array(data.buffer, data.byteOffset + offset, fillListLength);
    this.fillList = BitmapUtils.deserialize(fillListBytes);
    offset += fillListLength;

    // Read index mappings
    const mappingCount = view.getUint32(offset, true);
    offset += 4;

    this.indexMap.clear();
    this.reverseMap.clear();

    for (let i = 0; i < mappingCount; i++) {
      // Read key
      const keyLength = view.getUint32(offset, true);
      offset += 4;
      const keyBytes = new Uint8Array(data.buffer, data.byteOffset + offset, keyLength);
      const key = decoder.decode(keyBytes);
      offset += keyLength;

      // Read bitmap
      const bitmapLength = view.getUint32(offset, true);
      offset += 4;
      const bitmapBytes = new Uint8Array(data.buffer, data.byteOffset + offset, bitmapLength);
      const bitmap = BitmapUtils.deserialize(bitmapBytes);
      offset += bitmapLength;

      // Restore mappings
      this.indexMap.set(key, bitmap);

      // Restore reverse mappings
      for (const index of bitmap) {
        if (!this.reverseMap.has(index)) {
          this.reverseMap.set(index, new Set());
        }
        this.reverseMap.get(index)!.add(key);
      }
    }
  }

  override clone(): IndexColumn {
    const cloned = new IndexColumn(this.name, this.targetColumnName, this.predicate, this.options);
    // Deep copy the index maps
    for (const [key, bitmap] of this.indexMap) {
      cloned.indexMap.set(key, bitmap.clone());
    }

    // Clone reverse maps
    for (const [index, keys] of this.reverseMap.entries()) {
      cloned.reverseMap.set(index, new Set(keys));
    }

    // Clone the fillList
    cloned.fillList = this.fillList.clone()

    return cloned;
  }

  override createReader(txnState: TransactionState): IndexColumnReader {
    return new IndexColumnReader(this, txnState);
  }

  /**
   * Create an index key from a value
   */
  private createIndexKey(value: any): string {
    if (value === null) {
      return '_null_';
    }
    if (value === undefined) {
      return '_undefined_';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Parse an index key back to a value
   */
  private parseIndexKey(key: string): any {
    if (key === '_null_') {
      return null;
    }
    if (key === '_undefined_') {
      return undefined;
    }
    if (key.startsWith('{') || key.startsWith('[')) {
      try {
        return JSON.parse(key);
      } catch {
        return key;
      }
    }
    return key;
  }

  /**
   * Extract value from reader using predicate context
   */
  private async extractValue(reader: Reader): Promise<any> {
    // This is a simplified extraction - in a real implementation,
    // this would need to be more sophisticated based on the predicate
    try {
      if (reader.getRaw) {
        return await reader.getRaw();
      }
    } catch {
      // Fall through to other getters
    }
    return reader.getString() || reader.getInt() || reader.getFloat() || reader.getBoolean();
  }
}

/**
 * Index column reader for transactions
 */
export class IndexColumnReader extends ColumnReader<IndexEntry> {
  override column: IndexColumn;

  constructor(column: IndexColumn, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  async getIndexEntry(): Promise<IndexEntry | undefined> {
    return await this.column.get(this.getCurrentIndex());
  }

  async getValue(): Promise<any> {
    const entry = await this.getIndexEntry();
    return entry?.value;
  }

  async getBitmap(): Promise<TypedFastBitSet | undefined> {
    const entry = await this.getIndexEntry();
    return entry?.bitmap;
  }
}

/**
 * Index manager for coordinating multiple indexes
 */
export class IndexManager {
  private indexes: Map<string, IndexColumn>;

  constructor() {
    this.indexes = new Map();
  }

  /**
   * Register an index
   */
  addIndex(index: IndexColumn): void {
    this.indexes.set(index.getName(), index);
  }

  /**
   * Remove an index
   */
  removeIndex(name: string): boolean {
    return this.indexes.delete(name);
  }

  /**
   * Get an index by name
   */
  getIndex(name: string): IndexColumn | undefined {
    return this.indexes.get(name);
  }

  /**
   * Get all indexes for a target column
   */
  getIndexesForColumn(columnName: string): IndexColumn[] {
    return Array.from(this.indexes.values())
      .filter(index => index.getTargetColumn() === columnName);
  }

  /**
   * Find the best index for a given predicate
   */
  findBestIndex(targetColumn: string, predicate: Predicate): IndexColumn | undefined {
    const candidates = this.getIndexesForColumn(targetColumn);

    // Simple heuristic: return the first matching index
    // In a real implementation, this would be more sophisticated
    return candidates.find(index => index.getPredicate() === predicate);
  }

  /**
   * Get all index names
   */
  getIndexNames(): string[] {
    return Array.from(this.indexes.keys());
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.indexes.clear();
  }

  /**
   * Get statistics for all indexes
   */
  getStats(): {
    indexCount: number;
    totalValues: number;
    totalMappings: number;
    memoryUsage: number;
  } {
    let totalValues = 0;
    let totalMappings = 0;
    let memoryUsage = 0;

    for (const index of this.indexes.values()) {
      const stats = index.getIndexStats();
      totalValues += stats.indexedValues;
      totalMappings += stats.totalMappings;
      memoryUsage += stats.memoryUsage.estimatedBytes;
    }

    return {
      indexCount: this.indexes.size,
      totalValues,
      totalMappings,
      memoryUsage
    };
  }
}

// Factory function
export const createIndexColumn = (
  name: string,
  targetColumn: string,
  predicate: Predicate,
  options?: Record<string, any>
) => new IndexColumn(name, targetColumn, predicate, options);
