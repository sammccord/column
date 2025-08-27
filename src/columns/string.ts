import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type { 
  Reader,
  TransactionState,
  StringAccessor
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { HashStringMap } from '../utils/hash.js';
import { CHUNK_SIZE, COLUMN_TYPE_CODES, STRING_INTERN_THRESHOLD } from '../constants.js';

/**
 * String column implementation for storing arbitrary strings
 */
export class StringColumn extends BaseColumn<string> {
  constructor(name: string, options: Record<string, any> = {}) {
    super(name, 'string', options);
  }

  protected async setInternal(index: number, value: string): Promise<void> {
    if (typeof value !== 'string') {
      throw new Error(`Expected string value, got ${typeof value}`);
    }
    this.data.set(index, value);
  }

  protected async getInternal(index: number): Promise<string | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    this.data.set(index, undefined as any);
  }

  /**
   * Create a string accessor for transaction use
   */
  createAccessor(txnState: TransactionState): StringAccessor {
    return new StringColumnAccessor(this, txnState);
  }

  /**
   * Filter strings by prefix
   */
  async filterByPrefix(prefix: string, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const result = new TypedFastBitSet();

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined && value.startsWith(prefix)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter strings by suffix
   */
  async filterBySuffix(suffix: string, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const result = new TypedFastBitSet();

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined && value.endsWith(suffix)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter strings by substring
   */
  async filterBySubstring(substring: string, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const result = new TypedFastBitSet();

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined && value.includes(substring)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter strings by regex pattern
   */
  async filterByRegex(pattern: RegExp, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const result = new TypedFastBitSet();

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined && pattern.test(value)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  async serialize(): Promise<Uint8Array> {
    const chunks = this.getDirtyChunks();
    const fillListBytes = BitmapUtils.serialize(this.fillList);
    
    // Collect all strings and calculate size
    const allStrings: string[][] = [];
    let totalStringLength = 0;
    
    for (const chunkId of chunks) {
      const chunk = this.data.getChunk(chunkId);
      const strings: string[] = [];
      
      for (const str of chunk) {
        if (str !== undefined) {
          if (str === '') {
            strings.push('\0'); // Use null character to represent empty string
            totalStringLength += 1;
          } else {
            strings.push(str);
            totalStringLength += new TextEncoder().encode(str).length;
          }
        } else {
          strings.push('\x01'); // Use different character to represent undefined  
          totalStringLength += 1;
        }
      }
      
      allStrings.push(strings);
    }

    // Calculate total size
    let totalSize = 0;
    totalSize += 4; // version
    totalSize += 1; // type code
    totalSize += 4; // fill list length
    totalSize += fillListBytes.length;
    totalSize += 4; // chunk count
    totalSize += chunks.length * 4; // chunk string counts
    totalSize += totalStringLength + (allStrings.flat().length * 4); // strings + length prefixes

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const encoder = new TextEncoder();
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;
    
    view.setUint8(offset, COLUMN_TYPE_CODES.STRING);
    offset += 1;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write chunks
    view.setUint32(offset, chunks.length, true);
    offset += 4;

    for (const strings of allStrings) {
      view.setUint32(offset, strings.length, true);
      offset += 4;
      
      for (const str of strings) {
        const strBytes = encoder.encode(str);
        view.setUint32(offset, strBytes.length, true);
        offset += 4;
        new Uint8Array(buffer, offset, strBytes.length).set(strBytes);
        offset += strBytes.length;
      }
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
      throw new Error(`Unsupported string column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;
    
    if (typeCode !== COLUMN_TYPE_CODES.STRING) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.STRING}, got ${typeCode}`);
    }

    // Read fill list
    const fillListLength = view.getUint32(offset, true);
    offset += 4;
    
    const fillListBytes = new Uint8Array(data.buffer, data.byteOffset + offset, fillListLength);
    this.fillList = BitmapUtils.deserialize(fillListBytes);
    offset += fillListLength;

    // Read chunks
    const chunkCount = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < chunkCount; i++) {
      const stringCount = view.getUint32(offset, true);
      offset += 4;
      
      const chunk = this.data.getChunk(i);
      
      for (let j = 0; j < stringCount; j++) {
        const strLength = view.getUint32(offset, true);
        offset += 4;
        
        if (strLength > 0) {
          const strBytes = new Uint8Array(data.buffer, data.byteOffset + offset, strLength);
          const str = decoder.decode(strBytes);
          if (str === '\0') {
            chunk[j] = ''; // Null character represents empty string
          } else if (str === '\x01') {
            chunk[j] = undefined as any; // SOH character represents undefined
          } else {
            chunk[j] = str; // Regular string
          }
        } else {
          chunk[j] = undefined as any; // Zero length means undefined
        }
        
        offset += strLength;
      }
    }
  }

  clone(): StringColumn {
    const cloned = new StringColumn(this.name, this.options);
    cloned.fillList = this.fillList.clone();
    cloned.data = this.data.clone();
    return cloned;
  }

  createReader(txnState: TransactionState): StringColumnReader {
    return new StringColumnReader(this, txnState);
  }
}

/**
 * Enum column implementation for storing deduplicated strings
 * Uses hash-based string interning for memory efficiency
 */
export class EnumColumn extends BaseColumn<number> {
  private stringMap: HashStringMap;

  constructor(name: string, options: Record<string, any> = {}) {
    super(name, 'enum', options);
    this.stringMap = new HashStringMap();
  }

  /**
   * Set a string value (will be converted to enum index)
   */
  async setString(index: number, value: string): Promise<void> {
    if (this.isDropped) {
      throw new Error('Cannot set value on dropped column');
    }

    await this.mutex.withLock(async () => {
      const enumIndex = this.stringMap.findOrAdd(value);
      await this.setInternal(index, enumIndex);
      this.fillList.add(index);
      this.markChunkDirty(index);
    });
  }

  /**
   * Get string value at index
   */
  async getString(index: number): Promise<string | undefined> {
    if (!this.fillList.has(index)) {
      return undefined;
    }

    return this.mutex.withLock(async () => {
      const enumIndex = await this.getInternal(index);
      if (enumIndex === undefined) {
        return undefined;
      }
      return this.stringMap.getString(enumIndex);
    });
  }

  protected async setInternal(index: number, value: number): Promise<void> {
    this.data.set(index, value);
  }

  protected async getInternal(index: number): Promise<number | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    this.data.set(index, undefined as any);
  }

  /**
   * Get unique string values in this enum
   */
  getUniqueValues(): readonly string[] {
    return this.stringMap.getStrings();
  }

  /**
   * Get statistics about string deduplication
   */
  getDeduplicationStats(): {
    uniqueStrings: number;
    totalInstances: number;
    compressionRatio: number;
    memoryStats: ReturnType<HashStringMap['getStats']>;
  } {
    const stats = this.stringMap.getStats();
    const instances = this.size();
    
    return {
      uniqueStrings: stats.uniqueStrings,
      totalInstances: instances,
      compressionRatio: instances > 0 ? stats.uniqueStrings / instances : 0,
      memoryStats: stats
    };
  }

  /**
   * Filter by exact string value
   */
  async filterByValue(value: string, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const result = new TypedFastBitSet();

    await this.mutex.withLock(async () => {
      const targetIndex = this.stringMap.findOrAdd(value);
      
      for (const index of targetBitmap) {
        const enumIndex = this.data.get(index);
        if (enumIndex === targetIndex) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Create an enum accessor for transaction use
   */
  createAccessor(txnState: TransactionState): EnumColumnAccessor {
    return new EnumColumnAccessor(this, txnState);
  }

  async serialize(): Promise<Uint8Array> {
    const chunks = this.getDirtyChunks();
    const fillListBytes = BitmapUtils.serialize(this.fillList);
    const strings = this.stringMap.getStrings();
    
    // Calculate string dictionary size
    const encoder = new TextEncoder();
    let dictSize = 4; // string count
    for (const str of strings) {
      dictSize += 4 + encoder.encode(str).length; // length + data
    }

    // Calculate chunk data size
    let chunkDataSize = 4; // chunk count
    for (const chunkId of chunks) {
      chunkDataSize += 4 + (CHUNK_SIZE * 4); // chunk size + indices
    }

    // Calculate total size
    const totalSize = 4 + 1 + 4 + fillListBytes.length + dictSize + chunkDataSize;

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;
    
    view.setUint8(offset, COLUMN_TYPE_CODES.ENUM);
    offset += 1;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write string dictionary
    view.setUint32(offset, strings.length, true);
    offset += 4;
    
    for (const str of strings) {
      const strBytes = encoder.encode(str);
      view.setUint32(offset, strBytes.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, strBytes.length).set(strBytes);
      offset += strBytes.length;
    }

    // Write chunks
    view.setUint32(offset, chunks.length, true);
    offset += 4;

    for (const chunkId of chunks) {
      const chunk = this.data.getChunk(chunkId);
      
      for (let i = 0; i < CHUNK_SIZE; i++) {
        const value = chunk[i];
        view.setUint32(offset, value !== undefined ? value : 0xFFFFFFFF, true);
        offset += 4;
      }
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
      throw new Error(`Unsupported enum column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;
    
    if (typeCode !== COLUMN_TYPE_CODES.ENUM) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.ENUM}, got ${typeCode}`);
    }

    // Read fill list
    const fillListLength = view.getUint32(offset, true);
    offset += 4;
    
    const fillListBytes = new Uint8Array(data.buffer, data.byteOffset + offset, fillListLength);
    this.fillList = BitmapUtils.deserialize(fillListBytes);
    offset += fillListLength;

    // Read string dictionary
    const stringCount = view.getUint32(offset, true);
    offset += 4;
    
    this.stringMap.clear();
    for (let i = 0; i < stringCount; i++) {
      const strLength = view.getUint32(offset, true);
      offset += 4;
      
      const strBytes = new Uint8Array(data.buffer, data.byteOffset + offset, strLength);
      const str = decoder.decode(strBytes);
      this.stringMap.findOrAdd(str); // Rebuild the string map
      offset += strLength;
    }

    // Read chunks
    const chunkCount = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < chunkCount; i++) {
      const chunk = this.data.getChunk(i);
      
      for (let j = 0; j < CHUNK_SIZE; j++) {
        const value = view.getUint32(offset, true);
        chunk[j] = value !== 0xFFFFFFFF ? value : undefined;
        offset += 4;
      }
    }
  }

  clone(): EnumColumn {
    const cloned = new EnumColumn(this.name, this.options);
    cloned.fillList = this.fillList.clone();
    cloned.data = this.data.clone();
    cloned.stringMap = this.stringMap.clone();
    return cloned;
  }

  createReader(txnState: TransactionState): EnumColumnReader {
    return new EnumColumnReader(this, txnState);
  }

  private markChunkDirty(index: number): void {
    const chunkId = Math.floor(index / CHUNK_SIZE);
    this.data.getMetadata(chunkId).isDirty = true;
  }
}

/**
 * String column reader for transactions
 */
export class StringColumnReader extends ColumnReader<string> {
  private column: StringColumn;

  constructor(column: StringColumn, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  getString(): string | undefined {
    return this.column.data.get(this.getCurrentIndex());
  }
}

/**
 * Enum column reader for transactions
 */
export class EnumColumnReader extends ColumnReader<number> {
  private column: EnumColumn;

  constructor(column: EnumColumn, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  getString(): string | undefined {
    const enumIndex = this.column.data.get(this.getCurrentIndex());
    if (enumIndex === undefined) {
      return undefined;
    }
    return this.column.stringMap.getString(enumIndex);
  }
}

/**
 * String column accessor for transactions
 */
export class StringColumnAccessor implements StringAccessor {
  private column: StringColumn;
  private txnState: TransactionState;

  constructor(column: StringColumn, txnState: TransactionState) {
    this.column = column;
    this.txnState = txnState;
  }

  get(): string | undefined {
    return this.column.data.get(this.txnState.cursor);
  }

  name(): string {
    return this.column.getName();
  }
}

/**
 * Enum column accessor for transactions
 */
export class EnumColumnAccessor implements StringAccessor {
  private column: EnumColumn;
  private txnState: TransactionState;

  constructor(column: EnumColumn, txnState: TransactionState) {
    this.column = column;
    this.txnState = txnState;
  }

  get(): string | undefined {
    const enumIndex = this.column.data.get(this.txnState.cursor);
    if (enumIndex === undefined) {
      return undefined;
    }
    return this.column.stringMap.getString(enumIndex);
  }

  name(): string {
    return this.column.getName();
  }
}

// Factory functions
export const createStringColumn = (name: string, options?: Record<string, any>) => 
  new StringColumn(name, options);

export const createEnumColumn = (name: string, options?: Record<string, any>) => 
  new EnumColumn(name, options);