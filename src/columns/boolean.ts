import { TypedFastBitSet } from 'typedfastbitset';
import { BaseColumn, ColumnReader } from './base.js';
import type {
  Reader,
  TransactionState,
  BooleanAccessor
} from '../types.js';
import { BitmapUtils } from '../utils/bitmap.js';
import { CHUNK_SIZE, COLUMN_TYPE_CODES } from '../constants.js';

/**
 * Boolean column implementation optimized for space efficiency
 * Uses bitmaps to store boolean values with minimal memory overhead
 */
export class BooleanColumn extends BaseColumn<boolean> {
  private trueBits: TypedFastBitSet;

  constructor(name: string, options: Record<string, any> = {}) {
    super(name, 'boolean', options);
    this.trueBits = new TypedFastBitSet();
  }

  protected async setInternal(index: number, value: boolean): Promise<void> {
    if (typeof value !== 'boolean') {
      throw new Error(`Expected boolean value, got ${typeof value}`);
    }

    // Store true values in the trueBits bitmap
    if (value) {
      this.trueBits.add(index);
    } else {
      this.trueBits.remove(index);
    }

    // We don't use the data manager for booleans, just the bitmaps
  }

  protected async getInternal(index: number): Promise<boolean | undefined> {
    if (!this.fillList.has(index)) {
      return undefined;
    }

    return this.trueBits.has(index);
  }

  protected async removeInternal(index: number): Promise<void> {
    this.trueBits.remove(index);
  }

  /**
   * Get all true values as a bitmap
   */
  getTrueBitmap(): TypedFastBitSet {
    return BitmapUtils.and(this.fillList, this.trueBits);
  }

  /**
   * Get all false values as a bitmap
   */
  getFalseBitmap(): TypedFastBitSet {
    return BitmapUtils.andNot(this.fillList, this.trueBits);
  }

  /**
   * Count true values
   */
  countTrue(bitmap?: TypedFastBitSet): number {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const trueBitmap = BitmapUtils.and(targetBitmap, this.trueBits);
    return trueBitmap.size();
  }

  /**
   * Count false values
   */
  countFalse(bitmap?: TypedFastBitSet): number {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;
    const falseBitmap = BitmapUtils.andNot(targetBitmap, this.trueBits);
    return falseBitmap.size();
  }

  /**
   * Filter by boolean value
   */
  async filterByValue(value: boolean, bitmap?: TypedFastBitSet): Promise<TypedFastBitSet> {
    const targetBitmap = bitmap ? BitmapUtils.and(this.fillList, bitmap) : this.fillList;

    if (value) {
      return BitmapUtils.and(targetBitmap, this.trueBits);
    } else {
      return BitmapUtils.andNot(targetBitmap, this.trueBits);
    }
  }

  /**
   * Create a boolean accessor for transaction use
   */
  createAccessor(txnState: TransactionState): BooleanAccessor {
    return new BooleanColumnAccessor(this, txnState);
  }

  async serialize(): Promise<Uint8Array> {
    const fillListBytes = BitmapUtils.serialize(this.fillList);
    const trueBitsBytes = BitmapUtils.serialize(this.trueBits);

    // Calculate total size
    const totalSize = 4 + 1 + 4 + fillListBytes.length + 4 + trueBitsBytes.length;

    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header
    view.setUint32(offset, 1, true); // version
    offset += 4;

    view.setUint8(offset, COLUMN_TYPE_CODES.BOOLEAN);
    offset += 1;

    // Write fill list
    view.setUint32(offset, fillListBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, fillListBytes.length).set(fillListBytes);
    offset += fillListBytes.length;

    // Write true bits
    view.setUint32(offset, trueBitsBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, trueBitsBytes.length).set(trueBitsBytes);
    offset += trueBitsBytes.length;

    return new Uint8Array(buffer);
  }

  async deserialize(data: Uint8Array): Promise<void> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Read header
    const version = view.getUint32(offset, true);
    offset += 4;

    if (version !== 1) {
      throw new Error(`Unsupported boolean column version: ${version}`);
    }

    const typeCode = view.getUint8(offset);
    offset += 1;

    if (typeCode !== COLUMN_TYPE_CODES.BOOLEAN) {
      throw new Error(`Type code mismatch: expected ${COLUMN_TYPE_CODES.BOOLEAN}, got ${typeCode}`);
    }

    // Read fill list
    const fillListLength = view.getUint32(offset, true);
    offset += 4;

    const fillListBytes = new Uint8Array(data.buffer, data.byteOffset + offset, fillListLength);
    this.fillList = BitmapUtils.deserialize(fillListBytes);
    offset += fillListLength;

    // Read true bits
    const trueBitsLength = view.getUint32(offset, true);
    offset += 4;

    const trueBitsBytes = new Uint8Array(data.buffer, data.byteOffset + offset, trueBitsLength);
    this.trueBits = BitmapUtils.deserialize(trueBitsBytes);
    offset += trueBitsLength;
  }

  override clone(): BooleanColumn {
    const cloned = new BooleanColumn(this.name, this.options);
    cloned.fillList = this.fillList.clone();
    cloned.trueBits = this.trueBits.clone();
    return cloned;
  }

  override createReader(txnState: TransactionState): BooleanColumnReader {
    return new BooleanColumnReader(this, txnState);
  }

  /**
   * Get memory usage statistics
   */
  override getStats(): ReturnType<BaseColumn['getStats']> & {
    trueCount: number;
    falseCount: number;
    trueFillRatio: number;
  } {
    const baseStats = super.getStats();
    const trueCount = this.trueBits.size();
    const falseCount = this.size() - trueCount;

    return {
      ...baseStats,
      trueCount,
      falseCount,
      trueFillRatio: this.size() > 0 ? trueCount / this.size() : 0
    };
  }
}

/**
 * Boolean column reader for transactions
 */
export class BooleanColumnReader extends ColumnReader<boolean> {
  override column: BooleanColumn;

  constructor(column: BooleanColumn, txnState?: TransactionState) {
    super(column, txnState);
    this.column = column;
  }

  override getBoolean(): boolean | undefined {
    const index = this.getCurrentIndex();
    if (!this.column.getFillList().has(index)) {
      return undefined;
    }
    return (this.column as any).trueBits.has(index);
  }
}

/**
 * Boolean column accessor for transactions
 */
export class BooleanColumnAccessor implements BooleanAccessor {
  private column: BooleanColumn;
  private txnState: TransactionState;

  constructor(column: BooleanColumn, txnState: TransactionState) {
    this.column = column;
    this.txnState = txnState;
  }

  get(): boolean | undefined {
    if (!this.column.getFillList().has(this.txnState.cursor)) {
      return undefined;
    }
    return (this.column as any).trueBits.has(this.txnState.cursor);
  }

  name(): string {
    return this.column.getName();
  }
}

// Factory function
export const createBooleanColumn = (name: string, options?: Record<string, any>) =>
  new BooleanColumn(name, options);
