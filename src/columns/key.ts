import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type { 
  Reader,
  TransactionState
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { HashUtils } from '../utils/hash.js';
import { CHUNK_SIZE, COLUMN_TYPE_CODES, INDEX_LOAD_FACTOR } from '../constants.js';

/**
 * Primary key column implementation with hash-based key-to-offset mapping
 * Provides O(1) lookups by key value
 */
export class KeyColumn extends BaseColumn<string> {
  private keyToIndex: Map<string, number>;
  private indexToKey: Map<number, string>;
  private readonly unique: boolean;

  constructor(name: string, options: { unique?: boolean; [key: string]: any } = {}) {
    super(name, 'key', options);
    this.keyToIndex = new Map();
    this.indexToKey = new Map();
    this.unique = options.unique !== false; // Default to unique
  }

  protected async setInternal(index: number, value: string): Promise<void> {
    if (typeof value !== 'string') {
      throw new Error(`Expected string key value, got ${typeof value}`);
    }

    // Check for uniqueness if required
    if (this.unique) {
      const existingIndex = this.keyToIndex.get(value);
      if (existingIndex !== undefined && existingIndex !== index) {
        throw new Error(`Duplicate key: ${value}`);
      }
    }

    // Remove old key mapping if updating
    const oldKey = this.indexToKey.get(index);
    if (oldKey !== undefined) {
      this.keyToIndex.delete(oldKey);
    }

    // Set new mappings
    this.data.set(index, value);
    this.keyToIndex.set(value, index);
    this.indexToKey.set(index, value);
  }

  protected async getInternal(index: number): Promise<string | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    const key = this.indexToKey.get(index);
    if (key !== undefined) {
      this.keyToIndex.delete(key);
      this.indexToKey.delete(index);
    }
    this.data.set(index, undefined as any);
  }

  /**
   * Find the index for a given key
   */
  findIndex(key: string): number | undefined {
    return this.keyToIndex.get(key);
  }

  /**
   * Get the key for a given index
   */
  getKey(index: number): string | undefined {
    return this.indexToKey.get(index);
  }

  /**
   * Check if a key exists
   */
  hasKey(key: string): boolean {
    return this.keyToIndex.has(key);
  }

  /**
   * Get all keys
   */
  getAllKeys(): string[] {
    return Array.from(this.keyToIndex.keys());
  }

  /**
   * Get all key-index pairs
   */
  getAllPairs(): Array<[string, number]> {
    return Array.from(this.keyToIndex.entries());
  }

  /**
   * Filter by key prefix
   */
  async filterByPrefix(prefix: string, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const result = new TypedFastBitSet();
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    await this.mutex.withLock(async () => {
      for (const [key, index] of this.keyToIndex.entries()) {
        if (key.startsWith(prefix) && targetBitmap.has(index)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter by key suffix
   */
  async filterBySuffix(suffix: string, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const result = new TypedFastBitSet();
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    await this.mutex.withLock(async () => {
      for (const [key, index] of this.keyToIndex.entries()) {
        if (key.endsWith(suffix) && targetBitmap.has(index)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter by key pattern (regex)
   */
  async filterByPattern(pattern: RegExp, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const result = new TypedFastBitSet();
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    await this.mutex.withLock(async () => {
      for (const [key, index] of this.keyToIndex.entries()) {
        if (pattern.test(key) && targetBitmap.has(index)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter by multiple keys
   */
  async filterByKeys(keys: string[], bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const result = new TypedFastBitSet();
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const keySet = new Set(keys);

    await this.mutex.withLock(async () => {
      for (const [key, index] of this.keyToIndex.entries()) {
        if (keySet.has(key) && targetBitmap.has(index)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Get statistics about key distribution
   */
  getKeyStats(): {
    uniqueKeys: number;
    totalMappings: number;
    averageKeyLength: number;
    loadFactor: number;
    keyLengthDistribution: {
      min: number;
      max: number;
      median: number;
    };
  } {
    const keys = Array.from(this.keyToIndex.keys());
    const lengths = keys.map(key => key.length);
    
    lengths.sort((a, b) => a - b);
    
    return {
      uniqueKeys: keys.length,
      totalMappings: this.keyToIndex.size,
      averageKeyLength: lengths.length > 0 ? lengths.reduce((sum, len) => sum + len, 0) / lengths.length : 0,
      loadFactor: this.keyToIndex.size / Math.max(1, this.capacity()),
      keyLengthDistribution: {
        min: lengths[0] || 0,
        max: lengths[lengths.length - 1] || 0,
        median: lengths[Math.floor(lengths.length / 2)] || 0
      }
    };
  }

  async serialize(): Promise<Uint8Array> {
    const fillListBytes = BitmapUtils.serialize(this.fillList);
    const encoder = new TextEncoder();
    
    // Calculate size for key mappings
    let mappingSize = 4; // mapping count
    const mappings = Array.from(this.keyToIndex.entries());
    
    for (const [key, index] of mappings) {
      const keyBytes = encoder.encode(key);
      mappingSize += 4 + keyBytes.length + 4; // key length + key + index
    }

    // Calculate total size
    const totalSize = 4 + 1 + 4 + fillListBytes.length + mappingSize;

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;
    
    view.setUint8(offset, COLUMN_TYPE_CODES.KEY);
    offset += 1;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write key mappings
    view.setUint32(offset, mappings.length, true);
    offset += 4;

    for (const [key, index] of mappings) {
      const keyBytes = encoder.encode(key);
      
      // Write key
      view.setUint32(offset, keyBytes.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, keyBytes.length).set(keyBytes);
      offset += keyBytes.length;
      
      // Write index
      view.setUint32(offset, index, true);
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
      throw new Error(`Unsupported key column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;
    
    if (typeCode !== COLUMN_TYPE_CODES.KEY) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.KEY}, got ${typeCode}`);
    }

    // Read fill list
    const fillListLength = view.getUint32(offset, true);
    offset += 4;
    
    const fillListBytes = new Uint8Array(data.buffer, data.byteOffset + offset, fillListLength);
    this.fillList = BitmapUtils.deserialize(fillListBytes);
    offset += fillListLength;

    // Read key mappings
    const mappingCount = view.getUint32(offset, true);
    offset += 4;

    this.keyToIndex.clear();
    this.indexToKey.clear();

    for (let i = 0; i < mappingCount; i++) {
      // Read key
      const keyLength = view.getUint32(offset, true);
      offset += 4;
      
      const keyBytes = new Uint8Array(data.buffer, data.byteOffset + offset, keyLength);
      const key = decoder.decode(keyBytes);
      offset += keyLength;
      
      // Read index
      const index = view.getUint32(offset, true);
      offset += 4;
      
      // Restore mappings and data
      this.keyToIndex.set(key, index);
      this.indexToKey.set(index, key);
      this.data.set(index, key);
    }
  }

  clone(): KeyColumn {
    const cloned = new KeyColumn(this.name, { ...this.options, unique: this.unique });
    cloned.fillList = this.fillList.clone();
    cloned.data = this.data.clone();
    cloned.keyToIndex = new Map(this.keyToIndex);
    cloned.indexToKey = new Map(this.indexToKey);
    return cloned;
  }

  createReader(txnState: TransactionState): KeyColumnReader {
    return new KeyColumnReader(this, txnState);
  }

  /**
   * Validate key column integrity (for debugging)
   */
  validateIntegrity(): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check that all key->index mappings have corresponding index->key mappings
    for (const [key, index] of this.keyToIndex.entries()) {
      if (!this.indexToKey.has(index)) {
        errors.push(`Key '${key}' maps to index ${index} but reverse mapping missing`);
      }
      
      if (this.indexToKey.get(index) !== key) {
        errors.push(`Key '${key}' maps to index ${index} but reverse maps to '${this.indexToKey.get(index)}'`);
      }
      
      if (!this.fillList.has(index)) {
        errors.push(`Key '${key}' maps to index ${index} but index not in fill list`);
      }
    }

    // Check that all index->key mappings have corresponding key->index mappings
    for (const [index, key] of this.indexToKey.entries()) {
      if (!this.keyToIndex.has(key)) {
        errors.push(`Index ${index} maps to key '${key}' but reverse mapping missing`);
      }
      
      if (this.keyToIndex.get(key) !== index) {
        errors.push(`Index ${index} maps to key '${key}' but reverse maps to ${this.keyToIndex.get(key)}`);
      }
    }

    // Check for duplicate keys if unique is enabled
    if (this.unique) {
      const keySet = new Set();
      for (const key of this.keyToIndex.keys()) {
        if (keySet.has(key)) {
          errors.push(`Duplicate key found: '${key}'`);
        }
        keySet.add(key);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Key column reader for transactions
 */
export class KeyColumnReader extends ColumnReader<string> {
  private column: KeyColumn;

  constructor(column: KeyColumn, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  getString(): string | undefined {
    return this.column.data.get(this.getCurrentIndex());
  }

  /**
   * Get the key for the current index
   */
  getKey(): string | undefined {
    return this.column.getKey(this.getCurrentIndex());
  }
}

/**
 * Utility functions for key columns
 */
export class KeyColumnUtils {
  /**
   * Generate a unique key based on timestamp and random value
   */
  static generateUniqueKey(prefix: string = ''): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2);
    return `${prefix}${timestamp}_${random}`;
  }

  /**
   * Generate a hash-based key from an object
   */
  static generateHashKey(obj: any, prefix: string = ''): string {
    const hash = HashUtils.universalHash(obj);
    return `${prefix}${hash.toString(36)}`;
  }

  /**
   * Generate a UUID-like key
   */
  static generateUUIDKey(): string {
    const chars = '0123456789abcdef';
    let result = '';
    
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        result += '-';
      }
      result += chars[Math.floor(Math.random() * 16)];
    }
    
    return result;
  }

  /**
   * Validate key format
   */
  static validateKey(key: string, options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    allowEmpty?: boolean;
  } = {}): { valid: boolean; error?: string } {
    const { maxLength = 1000, pattern, allowEmpty = false } = options;
    const minLength = options.minLength ?? (allowEmpty ? 0 : 1);

    if (!allowEmpty && key.length === 0) {
      return { valid: false, error: 'Key cannot be empty' };
    }

    if (key.length < minLength) {
      return { valid: false, error: `Key too short (minimum ${minLength} characters)` };
    }

    if (key.length > maxLength) {
      return { valid: false, error: `Key too long (maximum ${maxLength} characters)` };
    }

    if (pattern && !pattern.test(key)) {
      return { valid: false, error: 'Key does not match required pattern' };
    }

    return { valid: true };
  }
}

// Factory function
export const createKeyColumn = (name: string, options?: { unique?: boolean; [key: string]: any }) => 
  new KeyColumn(name, options);