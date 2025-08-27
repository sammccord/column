import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type {
  NumericType,
  NumericValue,
  Reader,
  TransactionState,
  NumericAccessor
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { ChunkManager } from '../utils/chunk.js';
import { NUMERIC_TYPE_INFO, CHUNK_SIZE, COLUMN_TYPE_CODES } from '../constants.js';

/**
 * Generic numeric column implementation supporting all numeric types
 */
export class NumericColumn<T extends NumericType> extends BaseColumn<NumericValue<T>> {
  private readonly numericType: T;
  private readonly typeInfo: typeof NUMERIC_TYPE_INFO[T];

  constructor(name: string, numericType: T, options: Record<string, any> = {}) {
    super(name, numericType, options);
    this.numericType = numericType;
    this.typeInfo = NUMERIC_TYPE_INFO[numericType];

    // Override data manager to use typed arrays for better performance
    this.data = new ChunkManager(() => this.createTypedChunk());
  }

  /**
   * Create a typed array chunk for optimal numeric storage
   */
  private createTypedChunk(): NumericValue<T>[] {
    // Create an array that can hold the appropriate numeric type
    const chunk = new Array<NumericValue<T>>(CHUNK_SIZE);
    return chunk;
  }

  /**
   * Get the numeric type
   */
  getNumericType(): T {
    return this.numericType;
  }

  /**
   * Check if this is a floating-point type
   */
  isFloatingPoint(): boolean {
    return this.typeInfo.isFloat;
  }

  /**
   * Check if this is a 64-bit type (BigInt)
   */
  is64Bit(): boolean {
    return this.numericType === 'int64' || this.numericType === 'uint64';
  }

  /**
   * Validate numeric value for this column type
   */
  private validateValue(value: NumericValue<T>): boolean {
    if (this.is64Bit()) {
      return typeof value === 'bigint';
    } else {
      // For floating-point types, allow NaN and Infinity
      if (this.isFloatingPoint()) {
        return typeof value === 'number';
      } else {
        // For integer types, require finite numbers
        return typeof value === 'number' && isFinite(value);
      }
    }
  }

  /**
   * Convert value to the appropriate type if needed
   */
  private normalizeValue(value: number | bigint): NumericValue<T> {
    if (this.is64Bit()) {
      return (typeof value === 'bigint' ? value : BigInt(value)) as NumericValue<T>;
    } else {
      return (typeof value === 'number' ? value : Number(value)) as NumericValue<T>;
    }
  }

  protected async setInternal(index: number, value: NumericValue<T>): Promise<void> {
    if (!this.validateValue(value)) {
      throw new Error(`Invalid value type for ${this.numericType}: ${typeof value}`);
    }

    this.data.set(index, value);
  }

  protected async getInternal(index: number): Promise<NumericValue<T> | undefined> {
    return this.data.get(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    this.data.set(index, undefined as any);
  }

  /**
   * Sum all values in the specified bitmap
   */
  async sum(bitmap?: TypedFastBitSet): Promise<NumericValue<T>> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    if (targetBitmap.isEmpty()) {
      return this.is64Bit() ? 0n as NumericValue<T> : 0 as NumericValue<T>;
    }

    let sum: any = this.is64Bit() ? 0n : 0;

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined) {
          if (this.is64Bit()) {
            sum += value as bigint;
          } else {
            sum += value as number;
          }
        }
      }
    });

    return sum;
  }

  /**
   * Find minimum value in the specified bitmap
   */
  async min(bitmap?: TypedFastBitSet): Promise<NumericValue<T> | undefined> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    if (targetBitmap.isEmpty()) {
      return undefined;
    }

    let min: NumericValue<T> | undefined = undefined;

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined) {
          if (min === undefined) {
            min = value;
          } else if (this.is64Bit()) {
            if ((value as bigint) < (min as bigint)) {
              min = value;
            }
          } else {
            if ((value as number) < (min as number)) {
              min = value;
            }
          }
        }
      }
    });

    return min;
  }

  /**
   * Find maximum value in the specified bitmap
   */
  async max(bitmap?: TypedFastBitSet): Promise<NumericValue<T> | undefined> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    if (targetBitmap.isEmpty()) {
      return undefined;
    }

    let max: NumericValue<T> | undefined = undefined;

    await this.mutex.withLock(async () => {
      for (const index of targetBitmap) {
        const value = this.data.get(index);
        if (value !== undefined) {
          if (max === undefined) {
            max = value;
          } else if (this.is64Bit()) {
            if ((value as bigint) > (max as bigint)) {
              max = value;
            }
          } else {
            if ((value as number) > (max as number)) {
              max = value;
            }
          }
        }
      }
    });

    return max;
  }

  /**
   * Calculate average of values in the specified bitmap
   */
  async avg(bitmap?: TypedFastBitSet): Promise<number> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    if (targetBitmap.isEmpty()) {
      return 0;
    }

    const sum = await this.sum(bitmap);
    const count = targetBitmap.size();

    if (this.is64Bit()) {
      return Number(sum as bigint) / count;
    } else {
      return (sum as number) / count;
    }
  }

  /**
   * Create a numeric accessor for transaction use
   */
  createAccessor(txnState: TransactionState): NumericAccessor<T> {
    return new NumericColumnAccessor(this, txnState);
  }

  async serialize(): Promise<Uint8Array> {
    const chunks = this.getDirtyChunks();
    const fillListBytes = BitmapUtils.serialize(this.fillList);

    // Calculate total size needed
    let totalSize = 0;
    totalSize += 4; // version
    totalSize += 1; // type code
    totalSize += 4; // fill list length
    totalSize += fillListBytes.length;
    totalSize += 4; // chunk count

    // Add chunk data sizes
    const chunkData: Uint8Array[] = [];
    for (const chunkId of chunks) {
      const chunk = this.data.getChunk(chunkId);
      const chunkBytes = this.serializeChunk(chunk);
      chunkData.push(chunkBytes);
      totalSize += 4 + chunkBytes.length; // size + data
    }

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;

    view.setUint8(offset, this.getTypeCode());
    offset += 1;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write chunks
    view.setUint32(offset, chunks.length, true);
    offset += 4;

    for (let i = 0; i < chunks.length; i++) {
      const bytes = chunkData[i];
      if (bytes) {
        view.setUint32(offset, bytes.length, true);
        offset += 4;
        new Uint8Array(buffer, offset, bytes.length).set(bytes);
        offset += bytes.length;
      }
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
      throw new Error(`Unsupported numeric column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;

    if (typeCode !== this.getTypeCode()) {
      throw new Error(`Type code mismatch: expected ${this.getTypeCode()}, got ${typeCode}`);
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
      const chunkData = this.deserializeChunk(chunkBytes);

      // Store chunk data
      const chunkId = i; // Simplified - in production you'd store chunk IDs
      const chunk = this.data.getChunk(chunkId);
      for (let j = 0; j < chunkData.length; j++) {
        const value = chunkData[j];
        if (value !== undefined) {
          chunk[j] = value;
        }
      }

      offset += chunkSize;
    }
  }

  override clone(): NumericColumn<T> {
    const cloned = new NumericColumn(this.name, this.numericType, this.options);
    cloned.fillList = this.fillList.clone();
    cloned.data = this.data.clone();
    return cloned;
  }

  override createReader(txnState: TransactionState): NumericColumnReader<T> {
    return new NumericColumnReader(this, txnState);
  }

  /**
   * Get type code for serialization
   */
  private getTypeCode(): number {
    const typeKey = this.numericType.toUpperCase() as keyof typeof COLUMN_TYPE_CODES;
    return COLUMN_TYPE_CODES[typeKey];
  }

  /**
   * Serialize a single chunk
   */
  private serializeChunk(chunk: NumericValue<T>[]): Uint8Array {
    if (this.is64Bit()) {
      // Handle BigInt serialization
      const buffer = new ArrayBuffer(chunk.length * 8);
      const view = new DataView(buffer);

      for (let i = 0; i < chunk.length; i++) {
        const value = chunk[i];
        if (this.typeInfo.signed) {
          view.setBigInt64(i * 8, (value as bigint) || 0n, true);
        } else {
          view.setBigUint64(i * 8, (value as bigint) || 0n, true);
        }
      }

      return new Uint8Array(buffer);
    } else {
      // Handle regular number serialization
      const buffer = new ArrayBuffer(chunk.length * 8);
      const view = new DataView(buffer);

      for (let i = 0; i < chunk.length; i++) {
        const value = chunk[i];
        if (this.isFloatingPoint()) {
          view.setFloat64(i * 8, (value as number) || 0, true);
        } else {
          // Use signed BigInt for signed integers
          if (this.typeInfo.signed) {
            view.setBigInt64(i * 8, BigInt((value as number) || 0), true);
          } else {
            view.setBigUint64(i * 8, BigInt((value as number) || 0), true);
          }
        }
      }

      return new Uint8Array(buffer);
    }
  }

  /**
   * Deserialize a single chunk
   */
  private deserializeChunk(data: Uint8Array): NumericValue<T>[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const chunk = new Array<NumericValue<T>>(CHUNK_SIZE);
    const elementCount = data.length / 8;

    if (this.is64Bit()) {
      // Handle BigInt deserialization
      for (let i = 0; i < elementCount; i++) {
        let value: bigint;
        if (this.typeInfo.signed) {
          value = view.getBigInt64(i * 8, true);
        } else {
          value = view.getBigUint64(i * 8, true);
        }
        chunk[i] = value as NumericValue<T>;
      }
    } else {
      // Handle regular number deserialization
      for (let i = 0; i < elementCount; i++) {
        if (this.isFloatingPoint()) {
          const value = view.getFloat64(i * 8, true);
          chunk[i] = value as NumericValue<T>;
        } else {
          let value: bigint;
          if (this.typeInfo.signed) {
            value = view.getBigInt64(i * 8, true);
          } else {
            value = view.getBigUint64(i * 8, true);
          }
          chunk[i] = Number(value) as NumericValue<T>;
        }
      }
    }

    return chunk;
  }
}

/**
 * Numeric column reader for transactions
 */
export class NumericColumnReader<T extends NumericType> extends ColumnReader<NumericValue<T>> {
  override column: NumericColumn<T>;

  constructor(column: NumericColumn<T>, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  override getInt(): number | undefined {
    const index = this.getCurrentIndex();
    if (!this.column.contains(index)) {
      return undefined;
    }
    if (this.column.is64Bit()) {
      const value = (this.column as any).data.get(index) as bigint | undefined;
      return value !== undefined ? Number(value) : undefined;
    } else {
      return (this.column as any).data.get(index) as number | undefined;
    }
  }

  override getBigInt(): bigint | undefined {
    const index = this.getCurrentIndex();
    if (!this.column.contains(index)) {
      return undefined;
    }
    if (this.column.is64Bit()) {
      return (this.column as any).data.get(index) as bigint | undefined;
    } else {
      const value = (this.column as any).data.get(index) as number | undefined;
      return value !== undefined ? BigInt(value) : undefined;
    }
  }

  override getFloat(): number | undefined {
    const index = this.getCurrentIndex();
    if (!this.column.contains(index)) {
      return undefined;
    }
    if (this.column.is64Bit()) {
      const value = (this.column as any).data.get(index) as bigint | undefined;
      return value !== undefined ? Number(value) : undefined;
    } else {
      return (this.column as any).data.get(index) as number | undefined;
    }
  }
}

/**
 * Numeric column accessor for transactions
 */
export class NumericColumnAccessor<T extends NumericType> implements NumericAccessor<T> {
  private column: NumericColumn<T>;
  private txnState: TransactionState;

  constructor(column: NumericColumn<T>, txnState: TransactionState) {
    this.column = column;
    this.txnState = txnState;
  }

  get(): NumericValue<T> | undefined {
    const value = (this.column as any).data.get(this.txnState.cursor);
    return value;
  }

  sum(): NumericValue<T> {
    // For synchronous implementation, we'll calculate inline
    // In a real implementation, this might use cached aggregates
    let sum = this.column.isFloatingPoint() ? 0 : (this.column.is64Bit() ? 0n : 0);
    for (const index of this.txnState.index) {
      const value = (this.column as any).data.get(index);
      if (value !== undefined) {
        if (this.column.isFloatingPoint()) {
          sum = (sum as number) + (value as number);
        } else if (this.column.is64Bit()) {
          sum = (sum as bigint) + (value as bigint);
        } else {
          sum = (sum as number) + (value as number);
        }
      }
    }
    return sum as NumericValue<T>;
  }

  avg(): number {
    const sumValue = this.sum();
    const count = this.txnState.index.size();
    if (count === 0) return 0;
    
    if (typeof sumValue === 'bigint') {
      return Number(sumValue) / count;
    }
    return (sumValue as number) / count;
  }

  min(): NumericValue<T> | undefined {
    let min: NumericValue<T> | undefined = undefined;
    for (const index of this.txnState.index) {
      const value = (this.column as any).data.get(index) as NumericValue<T>;
      if (value !== undefined) {
        if (min === undefined || value < min) {
          min = value;
        }
      }
    }
    return min;
  }

  max(): NumericValue<T> | undefined {
    let max: NumericValue<T> | undefined = undefined;
    for (const index of this.txnState.index) {
      const value = (this.column as any).data.get(index) as NumericValue<T>;
      if (value !== undefined) {
        if (max === undefined || value > max) {
          max = value;
        }
      }
    }
    return max;
  }

  name(): string {
    return this.column.getName();
  }
}

// Factory functions for creating numeric columns
export const createInt8Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'int8', options);

export const createInt16Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'int16', options);

export const createInt32Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'int32', options);

export const createInt64Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'int64', options);

export const createUint8Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'uint8', options);

export const createUint16Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'uint16', options);

export const createUint32Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'uint32', options);

export const createUint64Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'uint64', options);

export const createFloat32Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'float32', options);

export const createFloat64Column = (name: string, options?: Record<string, any>) =>
  new NumericColumn(name, 'float64', options);
