import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type { 
  Reader,
  TransactionState,
  RecordAccessor
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { CHUNK_SIZE, COLUMN_TYPE_CODES } from '../constants.js';

/**
 * Interface for objects that can be marshaled/unmarshaled
 */
export interface Marshaler {
  marshal(): Uint8Array;
}

export interface Unmarshaler {
  unmarshal(data: Uint8Array): void;
}

/**
 * Interface for objects that can be marshaled to/from JSON
 */
export interface JSONMarshaler {
  toJSON(): any;
  fromJSON(data: any): void;
}

/**
 * Record column implementation for storing arbitrary objects
 * Supports both binary marshaling and JSON serialization
 */
export class RecordColumn<T = any> extends BaseColumn<T> {
  private readonly marshaler?: (value: T) => Uint8Array;
  private readonly unmarshaler?: (data: Uint8Array) => T;

  constructor(
    name: string, 
    options: {
      marshaler?: (value: T) => Uint8Array;
      unmarshaler?: (data: Uint8Array) => T;
      [key: string]: any;
    } = {}
  ) {
    super(name, 'record', options);
    this.marshaler = options.marshaler;
    this.unmarshaler = options.unmarshaler;
  }

  protected async setInternal(index: number, value: T): Promise<void> {
    if (value === null || value === undefined) {
      throw new Error('Record value cannot be null or undefined');
    }

    this.data.set(index, value);
  }

  protected async getInternal(index: number): Promise<T | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    this.data.set(index, undefined as any);
  }

  /**
   * Filter records based on a predicate function
   */
  async filterRecords(
    predicate: (record: T, index: number) => boolean,
    bitmap?: TypedFastBitSet
  ): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const result = new TypedFastBitSet();

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined && predicate(value, index)) {
          result.add(index);
        }
      }
    });

    return result;
  }

  /**
   * Filter records by a property value
   */
  async filterByProperty<K extends keyof T>(
    property: K,
    value: T[K],
    bitmap?: TypedFastBitSet
  ): Promise<TypedFastBitSet> {
    return this.filterRecords((record) => record[property] === value, bitmap);
  }

  /**
   * Filter records by nested property value using dot notation
   */
  async filterByNestedProperty(
    path: string,
    value: any,
    bitmap?: TypedFastBitSet
  ): Promise<TypedFastBitSet> {
    return this.filterRecords((record) => {
      const nestedValue = this.getNestedProperty(record, path);
      return nestedValue === value;
    }, bitmap);
  }

  /**
   * Map records to extract specific values
   */
  async mapRecords<R>(
    mapper: (record: T, index: number) => R,
    bitmap?: TypedFastBitSet
  ): Promise<R[]> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const results: R[] = [];

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined) {
          results.push(mapper(value, index));
        }
      }
    });

    return results;
  }

  /**
   * Extract a specific property from all records
   */
  async extractProperty<K extends keyof T>(
    property: K,
    bitmap?: TypedFastBitSet
  ): Promise<T[K][]> {
    return this.mapRecords((record) => record[property], bitmap);
  }

  /**
   * Create a record accessor for transaction use
   */
  createAccessor<R = T>(txnState: TransactionState): RecordAccessor<R> {
    return new RecordColumnAccessor(this, txnState);
  }

  async serialize(): Promise<Uint8Array> {
    const chunks = this.getDirtyChunks();
    const fillListBytes = BitmapUtils.serialize(this.fillList);
    
    // Serialize all record data
    const serializedChunks: Uint8Array[] = [];
    let totalDataSize = 0;

    for (const chunkId of chunks) {
      const chunk = this.data.getChunk(chunkId);
      const chunkData = await this.serializeChunk(chunk);
      serializedChunks.push(chunkData);
      totalDataSize += chunkData.length;
    }

    // Calculate total size
    const totalSize = 4 + 1 + 4 + fillListBytes.length + 4 + (chunks.length * 4) + totalDataSize;

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;
    
    view.setUint8(offset, COLUMN_TYPE_CODES.RECORD);
    offset += 1;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write chunks
    view.setUint32(offset, chunks.length, true);
    offset += 4;

    for (const chunkData of serializedChunks) {
      view.setUint32(offset, chunkData.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, chunkData.length).set(chunkData);
      offset += chunkData.length;
    }

    return new Uint8Array(buffer);
  }

  async deserialize(data: Uint8Array): Promise<void> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Read header
    const version = view.getUint32(offset, true);
    offset += 4;
    
    if (version !== 1) {
      throw new Error(`Unsupported record column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;
    
    if (typeCode !== COLUMN_TYPE_CODES.RECORD) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.RECORD}, got ${typeCode}`);
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
      const chunkSize = view.getUint32(offset, true);
      offset += 4;
      
      const chunkBytes = new Uint8Array(data.buffer, data.byteOffset + offset, chunkSize);
      const records = await this.deserializeChunk(chunkBytes);
      
      // Store records in chunk
      const chunk = this.data.getChunk(i);
      for (let j = 0; j < records.length; j++) {
        chunk[j] = records[j];
      }
      
      offset += chunkSize;
    }
  }

  clone(): RecordColumn<T> {
    const cloned = new RecordColumn(this.name, {
      ...this.options,
      marshaler: this.marshaler,
      unmarshaler: this.unmarshaler
    });
    cloned.fillList = this.fillList.clone();
    cloned.data = this.data.clone();
    return cloned;
  }

  createReader(txnState: TransactionState): RecordColumnReader<T> {
    return new RecordColumnReader(this, txnState);
  }

  /**
   * Serialize a single chunk of records
   */
  private async serializeChunk(chunk: T[]): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const serializedRecords: Uint8Array[] = [];
    let totalSize = 4; // record count

    for (let i = 0; i < CHUNK_SIZE; i++) {
      const record = chunk[i];
      let recordBytes: Uint8Array;

      if (record === undefined) {
        recordBytes = new Uint8Array(0);
      } else if (this.marshaler) {
        recordBytes = this.marshaler(record);
      } else if (this.isMarshaler(record)) {
        recordBytes = record.marshal();
      } else {
        // Fallback to JSON serialization
        const json = JSON.stringify(record);
        recordBytes = encoder.encode(json);
      }

      serializedRecords.push(recordBytes);
      totalSize += 4 + recordBytes.length; // size + data
    }

    // Create chunk buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write record count
    view.setUint32(offset, CHUNK_SIZE, true);
    offset += 4;

    // Write records
    for (const recordBytes of serializedRecords) {
      view.setUint32(offset, recordBytes.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, recordBytes.length).set(recordBytes);
      offset += recordBytes.length;
    }

    return new Uint8Array(buffer);
  }

  /**
   * Deserialize a single chunk of records
   */
  private async deserializeChunk(data: Uint8Array): Promise<T[]> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;

    // Read record count
    const recordCount = view.getUint32(offset, true);
    offset += 4;

    const records = new Array<T>(recordCount);

    for (let i = 0; i < recordCount; i++) {
      const recordSize = view.getUint32(offset, true);
      offset += 4;

      if (recordSize === 0) {
        records[i] = undefined as any;
      } else {
        const recordBytes = new Uint8Array(data.buffer, data.byteOffset + offset, recordSize);
        
        if (this.unmarshaler) {
          records[i] = this.unmarshaler(recordBytes);
        } else {
          // Fallback to JSON deserialization
          const json = decoder.decode(recordBytes);
          records[i] = JSON.parse(json);
        }
      }

      offset += recordSize;
    }

    return records;
  }

  /**
   * Get nested property value using dot notation
   */
  private getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => {
      return current && typeof current === 'object' ? current[prop] : undefined;
    }, obj);
  }

  /**
   * Type guard for Marshaler interface
   */
  private isMarshaler(obj: any): obj is Marshaler {
    return obj && typeof obj.marshal === 'function';
  }

  /**
   * Type guard for Unmarshaler interface
   */
  private isUnmarshaler(obj: any): obj is Unmarshaler {
    return obj && typeof obj.unmarshal === 'function';
  }
}

/**
 * Record column reader for transactions
 */
export class RecordColumnReader<T = any> extends ColumnReader<T> {
  private column: RecordColumn<T>;

  constructor(column: RecordColumn<T>, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  getRecord<R = T>(): R | undefined {
    return this.column.data.get(this.getCurrentIndex()) as R | undefined;
  }
}

/**
 * Record column accessor for transactions
 */
export class RecordColumnAccessor<T = any> implements RecordAccessor<T> {
  private column: RecordColumn<T>;
  private txnState: TransactionState;

  constructor(column: RecordColumn<T>, txnState: TransactionState) {
    this.column = column;
    this.txnState = txnState;
  }

  get(): T | undefined {
    return this.column.data.get(this.txnState.cursor);
  }

  name(): string {
    return this.column.getName();
  }
}

// Factory function
export const createRecordColumn = <T = any>(
  name: string, 
  options?: {
    marshaler?: (value: T) => Uint8Array;
    unmarshaler?: (data: Uint8Array) => T;
    [key: string]: any;
  }
) => new RecordColumn<T>(name, options);