import BTree from 'sorted-btree';
import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type {
  Reader,
  TransactionState,
  SortIndexItem
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { CHUNK_SIZE, COLUMN_TYPE_CODES } from '../constants.js';

/**
 * Comparator function for sort index items
 */
type SortComparator<T> = (a: T, b: T) => number;

/**
 * Default string comparator
 */
const defaultStringComparator: SortComparator<string> = (a, b) => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/**
 * Sorted index column implementation using B-tree
 * Provides sorted access to another column's values with range queries
 */
export class SortIndexColumn extends BaseColumn<SortIndexItem> {
  private readonly targetColumnName: string;
  private readonly btree: BTree<SortIndexItem>;
  private readonly reverseMap = new Map<number, string>(); // index -> sort key
  private readonly keyExtractor: (reader: Reader) => string;
  private readonly comparator: SortComparator<string>;

  constructor(
    name: string,
    targetColumnName: string,
    keyExtractor: (reader: Reader) => string,
    options: {
      comparator?: SortComparator<string>;
      [key: string]: any;
    } = {}
  ) {
    super(name, 'sort-index', options);
    this.targetColumnName = targetColumnName;
    this.keyExtractor = keyExtractor;
    this.comparator = options.comparator || defaultStringComparator;

    // Create B-tree with custom comparator
    this.btree = new BTree<SortIndexItem>([], (a, b) => {
      const keyCompare = this.comparator(a.key, b.key);
      if (keyCompare !== 0) return keyCompare;
      // If keys are equal, compare by value (index) for stable sorting
      return a.value - b.value;
    });
  }

  /**
   * Get the target column name this index is built on
   */
  getTargetColumnName(): string {
    return this.targetColumnName;
  }

  /**
   * Get the key extractor function
   */
  getKeyExtractor(): (reader: Reader) => string {
    return this.keyExtractor;
  }

  /**
   * Get the number of items in the sorted index
   */
  getSortedSize(): number {
    return this.btree.size;
  }

  /**
   * Add or update an entry in the sorted index
   */
  async updateSortEntry(index: number, targetColumn: BaseColumn): Promise<void> {
    await this.mutex.withLock(async () => {
      // Remove existing entry if it exists
      const existingKey = this.reverseMap.get(index);
      if (existingKey !== undefined) {
        this.btree.delete({ key: existingKey, value: index });
        this.reverseMap.delete(index);
        this.fillList.remove(index);
      }

      // Check if target column has value at this index
      if (!targetColumn.contains(index)) {
        return;
      }

      // Extract sort key and add to B-tree
      const reader = targetColumn.createReader({ cursor: index } as TransactionState);
      reader.setIndex(index);

      try {
        const sortKey = this.keyExtractor(reader);
        const item: SortIndexItem = { key: sortKey, value: index };

        this.btree.set(item, item); // B-tree uses first arg as key, second as value
        this.reverseMap.set(index, sortKey);
        this.fillList.add(index);
      } catch (error) {
        console.warn(`Sort key extraction failed for index ${index}:`, error);
      }
    });
  }

  /**
   * Remove an entry from the sorted index
   */
  async removeSortEntry(index: number): Promise<void> {
    await this.mutex.withLock(async () => {
      const existingKey = this.reverseMap.get(index);
      if (existingKey !== undefined) {
        this.btree.delete({ key: existingKey, value: index });
        this.reverseMap.delete(index);
        this.fillList.remove(index);
      }
    });
  }

  /**
   * Batch update multiple entries
   */
  async batchUpdate(indices: number[], targetColumn: BaseColumn): Promise<void> {
    await this.mutex.withLock(async () => {
      const reader = targetColumn.createReader({ cursor: 0 } as TransactionState);

      for (const index of indices) {
        // Remove existing entry
        const existingKey = this.reverseMap.get(index);
        if (existingKey !== undefined) {
          this.btree.delete({ key: existingKey, value: index });
          this.reverseMap.delete(index);
          this.fillList.remove(index);
        }

        // Add new entry if target has value
        if (targetColumn.contains(index)) {
          reader.setIndex(index);
          try {
            const sortKey = this.keyExtractor(reader);
            const item: SortIndexItem = { key: sortKey, value: index };

            this.btree.set(item, item);
            this.reverseMap.set(index, sortKey);
            this.fillList.add(index);
          } catch (error) {
            console.warn(`Sort key extraction failed for index ${index}:`, error);
          }
        }
      }
    });
  }

  /**
   * Rebuild the entire sorted index
   */
  async rebuild(targetColumn: BaseColumn): Promise<void> {
    await this.mutex.withLock(async () => {
      this.btree.clear();
      this.reverseMap.clear();
      this.fillList = new TypedFastBitSet();

      const reader = targetColumn.createReader({ cursor: 0 } as TransactionState);
      const fillList = targetColumn.getFillList();

      for (const index of fillList) {
        reader.setIndex(index);
        try {
          const sortKey = this.keyExtractor(reader);
          const item: SortIndexItem = { key: sortKey, value: index };

          this.btree.set(item, item);
          this.reverseMap.set(index, sortKey);
          this.fillList.add(index);
        } catch (error) {
          console.warn(`Sort key extraction failed for index ${index}:`, error);
        }
      }
    });
  }

  /**
   * Get items in sorted order within a range
   */
  async getRange(
    startKey?: string,
    endKey?: string,
    includeEnd: boolean = false,
    limit?: number
  ): Promise<SortIndexItem[]> {
    return this.mutex.withLock(async () => {
      const results: SortIndexItem[] = [];
      let count = 0;

      const startItem = startKey ? { key: startKey, value: 0 } : undefined;
      const endItem = endKey ? { key: endKey, value: Number.MAX_SAFE_INTEGER } : undefined;

      for (const [item] of this.btree.entries(startItem)) {
        if (endItem) {
          const comparison = this.comparator(item.key, endKey!);
          if (comparison > 0 || (!includeEnd && comparison === 0)) {
            break;
          }
        }

        results.push(item);
        count++;

        if (limit && count >= limit) {
          break;
        }
      }

      return results;
    });
  }

  /**
   * Get items in reverse sorted order within a range
   */
  async getRangeReverse(
    startKey?: string,
    endKey?: string,
    includeEnd: boolean = false,
    limit?: number
  ): Promise<SortIndexItem[]> {
    return this.mutex.withLock(async () => {
      const results: SortIndexItem[] = [];
      let count = 0;

      const startItem = startKey ? { key: startKey, value: Number.MAX_SAFE_INTEGER } : undefined;
      const endItem = endKey ? { key: endKey, value: 0 } : undefined;

      for (const [item] of this.btree.entriesReversed(startItem)) {
        if (endItem) {
          const comparison = this.comparator(item.key, endKey!);
          if (comparison < 0 || (!includeEnd && comparison === 0)) {
            break;
          }
        }

        results.push(item);
        count++;

        if (limit && count >= limit) {
          break;
        }
      }

      return results;
    });
  }

  /**
   * Get all items sorted by key
   */
  async getAllSorted(): Promise<SortIndexItem[]> {
    return this.mutex.withLock(async () => {
      return Array.from(this.btree.keys());
    });
  }

  /**
   * Get indices in sorted order
   */
  async getSortedIndices(
    startKey?: string,
    endKey?: string,
    includeEnd?: boolean,
    limit?: number
  ): Promise<number[]> {
    const items = await this.getRange(startKey, endKey, includeEnd, limit);
    return items.map(item => item.value);
  }

  /**
   * Get indices as bitmap in sorted order
   */
  async getSortedBitmap(
    startKey?: string,
    endKey?: string,
    includeEnd?: boolean,
    limit?: number
  ): Promise<TypedFastBitSet> {
    const indices = await this.getSortedIndices(startKey, endKey, includeEnd, limit);
    return BitmapUtils.fromIndices(indices);
  }

  /**
   * Find the first item with key >= searchKey
   */
  async findFirstGTE(searchKey: string): Promise<SortIndexItem | undefined> {
    return this.mutex.withLock(async () => {
      const searchItem = { key: searchKey, value: 0 };

      for (const [item] of this.btree.entries(searchItem)) {
        if (this.comparator(item.key, searchKey) >= 0) {
          return item;
        }
      }

      return undefined;
    });
  }

  /**
   * Find the last item with key <= searchKey
   */
  async findLastLTE(searchKey: string): Promise<SortIndexItem | undefined> {
    return this.mutex.withLock(async () => {
      const searchItem = { key: searchKey, value: Number.MAX_SAFE_INTEGER };

      for (const [item] of this.btree.entriesReversed(searchItem)) {
        if (this.comparator(item.key, searchKey) <= 0) {
          return item;
        }
      }

      return undefined;
    });
  }

  /**
   * Get the minimum key in the index
   */
  async getMinKey(): Promise<string | undefined> {
    return this.mutex.withLock(async () => {
      if (this.btree.size === 0) return undefined;
      return this.btree.minKey()?.key;
    });
  }

  /**
   * Get the maximum key in the index
   */
  async getMaxKey(): Promise<string | undefined> {
    return this.mutex.withLock(async () => {
      if (this.btree.size === 0) return undefined;
      return this.btree.maxKey()?.key;
    });
  }

  /**
   * Check if the sorted index contains a specific key
   */
  hasKey(key: string): boolean {
    const searchItem = { key, value: 0 };
    return this.btree.has(searchItem);
  }

  /**
   * Get the sort key for a specific index
   */
  getSortKey(index: number): string | undefined {
    return this.reverseMap.get(index);
  }

  // BaseColumn method implementations
  protected async setInternal(index: number, value: SortIndexItem): Promise<void> {
    // Sort index columns are computed, not directly settable
    throw new Error('Sort index columns are computed and cannot be set directly');
  }

  protected async getInternal(index: number): Promise<SortIndexItem | undefined> {
    const key = this.reverseMap.get(index);
    return key ? { key, value: index } : undefined;
  }

  protected async removeInternal(index: number): Promise<void> {
    await this.removeSortEntry(index);
  }

  async serialize(): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const targetColumnBytes = encoder.encode(this.targetColumnName);
    const fillListBytes = BitmapUtils.serialize(this.fillList);

    // Serialize sorted items
    const sortedItems = await this.getAllSorted();
    let itemsSize = 4; // item count

    for (const item of sortedItems) {
      const keyBytes = encoder.encode(item.key);
      itemsSize += 4 + keyBytes.length + 4; // key length + key + value
    }

    const totalSize = 4 + 1 + 4 + targetColumnBytes.length + 4 + fillListBytes.length + itemsSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;

    view.setUint8(offset, COLUMN_TYPE_CODES.SORT_INDEX);
    offset += 1;

    // Write target column name
    view.setUint32(offset, targetColumnBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, targetColumnBytes.length).set(targetColumnBytes);
    offset += targetColumnBytes.length;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write sorted items
    view.setUint32(offset, sortedItems.length, true);
    offset += 4;

    for (const item of sortedItems) {
      const keyBytes = encoder.encode(item.key);

      // Write key
      view.setUint32(offset, keyBytes.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, keyBytes.length).set(keyBytes);
      offset += keyBytes.length;

      // Write value
      view.setUint32(offset, item.value, true);
      offset += 4;
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
      throw new Error(`Unsupported sort index column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;

    if (typeCode !== COLUMN_TYPE_CODES.SORT_INDEX) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.SORT_INDEX}, got ${typeCode}`);
    }

    // Read target column name
    const targetColumnLength = view.getUint32(offset, true);
    offset += 4;

    const targetColumnBytes = new Uint8Array(data.buffer, data.byteOffset + offset, targetColumnLength);
    const targetColumnName = decoder.decode(targetColumnBytes);
    offset += targetColumnLength;

    // Validate target column name
    if (targetColumnName !== this.targetColumnName) {
      console.warn(`Target column name mismatch: expected ${this.targetColumnName}, got ${targetColumnName}`);
    }

    // Read fill list
    const fillListLength = view.getUint32(offset, true);
    offset += 4;

    const fillListBytes = new Uint8Array(data.buffer, data.byteOffset + offset, fillListLength);
    this.fillList = BitmapUtils.deserialize(fillListBytes);
    offset += fillListLength;

    // Read sorted items
    const itemCount = view.getUint32(offset, true);
    offset += 4;

    this.btree.clear();
    this.reverseMap.clear();

    for (let i = 0; i < itemCount; i++) {
      // Read key
      const keyLength = view.getUint32(offset, true);
      offset += 4;

      const keyBytes = new Uint8Array(data.buffer, data.byteOffset + offset, keyLength);
      const key = decoder.decode(keyBytes);
      offset += keyLength;

      // Read value
      const value = view.getUint32(offset, true);
      offset += 4;

      // Restore B-tree and reverse map
      const item: SortIndexItem = { key, value };
      this.btree.set(item, item);
      this.reverseMap.set(value, key);
    }
  }

  override clone(): SortIndexColumn {
    const cloned = new SortIndexColumn(
      this.name,
      this.targetColumnName,
      this.keyExtractor,
      { ...this.options, comparator: this.comparator }
    );

    cloned.fillList = this.fillList.clone();

    // Clone B-tree and reverse map
    for (const [key, value] of this.reverseMap.entries()) {
      const item: SortIndexItem = { key: value, value: key };
      cloned.btree.set(item, item);
      cloned.reverseMap.set(key, value);
    }

    return cloned;
  }

  createReader(txnState: TransactionState): SortIndexColumnReader {
    return new SortIndexColumnReader(this, txnState);
  }

  /**
   * Get statistics about this sorted index
   */
  getSortIndexStats(): {
    name: string;
    targetColumn: string;
    size: number;
    minKey?: string;
    maxKey?: string;
    memoryUsage: {
      btreeNodes: number;
      reverseMap: number;
    };
  } {
    return {
      name: this.name,
      targetColumn: this.targetColumnName,
      size: this.btree.size,
      minKey: this.btree.minKey()?.key,
      maxKey: this.btree.maxKey()?.key,
      memoryUsage: {
        btreeNodes: this.btree.size * 64, // Rough estimate
        reverseMap: this.reverseMap.size * 32 // Rough estimate
      }
    };
  }
}

/**
 * Sort index column reader for transactions
 */
export class SortIndexColumnReader extends ColumnReader<SortIndexItem> {
  protected column: SortIndexColumn;

  constructor(column: SortIndexColumn, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  /**
   * Get the sort key for the current index
   */
  getSortKey(): string | undefined {
    return this.column.getSortKey(this.getCurrentIndex());
  }

  /**
   * Get the sort item for the current index
   */
  getSortItem(): SortIndexItem | undefined {
    const key = this.getSortKey();
    return key ? { key, value: this.getCurrentIndex() } : undefined;
  }
}

/**
 * Utility functions for creating common sort indexes
 */
export class SortIndexUtils {
  /**
   * Create a string sort index
   */
  static createStringIndex(
    name: string,
    targetColumn: string,
    comparator?: SortComparator<string>
  ): SortIndexColumn {
    return new SortIndexColumn(
      name,
      targetColumn,
      (reader) => reader.getString() || '',
      { comparator }
    );
  }

  /**
   * Create a numeric sort index
   */
  static createNumericIndex(
    name: string,
    targetColumn: string
  ): SortIndexColumn {
    return new SortIndexColumn(
      name,
      targetColumn,
      (reader) => {
        const num = reader.getInt() || reader.getFloat() || 0;
        return num.toString().padStart(20, '0'); // Zero-pad for proper string sorting
      },
      {
        comparator: (a, b) => {
          const numA = parseFloat(a);
          const numB = parseFloat(b);
          return numA - numB;
        }
      }
    );
  }

  /**
   * Create a date sort index
   */
  static createDateIndex(
    name: string,
    targetColumn: string
  ): SortIndexColumn {
    return new SortIndexColumn(
      name,
      targetColumn,
      (reader) => {
        const record = reader.getRecord<{ date?: Date | string | number }>();
        if (!record?.date) return '';

        const date = record.date instanceof Date ? record.date : new Date(record.date);
        return date.toISOString();
      }
    );
  }

  /**
   * Create a custom field sort index for record columns
   */
  static createRecordFieldIndex(
    name: string,
    targetColumn: string,
    fieldPath: string,
    comparator?: SortComparator<string>
  ): SortIndexColumn {
    return new SortIndexColumn(
      name,
      targetColumn,
      (reader) => {
        const record = reader.getRecord<any>();
        if (!record) return '';

        const value = SortIndexUtils.getNestedProperty(record, fieldPath);
        return value?.toString() || '';
      },
      { comparator }
    );
  }

  /**
   * Get nested property value using dot notation
   */
  private static getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => {
      return current && typeof current === 'object' ? current[prop] : undefined;
    }, obj);
  }
}

// Factory function
export const createSortIndexColumn = (
  name: string,
  targetColumnName: string,
  keyExtractor: (reader: Reader) => string,
  options?: { comparator?: SortComparator<string>; [key: string]: any }
) => new SortIndexColumn(name, targetColumnName, keyExtractor, options);
