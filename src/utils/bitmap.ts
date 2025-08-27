import { TypedFastBitSet } from 'typedfastbitset';
import { CHUNK_SIZE, PERFORMANCE } from '../constants.js';
import type { NumericType, NumericValue } from '../types.js';

export class BitmapUtils {
  /**
   * Create a new bitmap with optional initial capacity
   */
  static create(capacity: number = CHUNK_SIZE): TypedFastBitSet {
    return new TypedFastBitSet();
  }

  /**
   * Create a bitmap from an array of indices
   */
  static fromIndices(indices: number[]): TypedFastBitSet {
    const bitmap = new TypedFastBitSet();
    for (const index of indices) {
      bitmap.add(index);
    }
    return bitmap;
  }

  /**
   * Create a bitmap from a range [start, end)
   */
  static fromRange(start: number, end: number): TypedFastBitSet {
    const bitmap = new TypedFastBitSet();
    for (let i = start; i < end; i++) {
      bitmap.add(i);
    }
    return bitmap;
  }

  /**
   * Logical AND operation between two bitmaps
   */
  static and(a: TypedFastBitSet, b: TypedFastBitSet): TypedFastBitSet {
    const result = a.clone();
    result.intersection(b);
    return result;
  }

  /**
   * Logical OR operation between two bitmaps
   */
  static or(a: TypedFastBitSet, b: TypedFastBitSet): TypedFastBitSet {
    const result = a.clone();
    result.union(b);
    return result;
  }

  /**
   * Logical AND NOT operation (a AND NOT b)
   */
  static andNot(a: TypedFastBitSet, b: TypedFastBitSet): TypedFastBitSet {
    const result = a.clone();
    result.difference(b);
    return result;
  }

  /**
   * Check if two bitmaps intersect
   */
  static intersects(a: TypedFastBitSet, b: TypedFastBitSet): boolean {
    return a.intersects(b);
  }

  /**
   * Get the number of set bits in the bitmap
   */
  static count(bitmap: TypedFastBitSet): number {
    return bitmap.size();
  }

  /**
   * Check if the bitmap is empty
   */
  static isEmpty(bitmap: TypedFastBitSet): boolean {
    return bitmap.isEmpty();
  }

  /**
   * Iterate over set bits in the bitmap
   */
  static range(bitmap: TypedFastBitSet, callback: (index: number) => boolean | void): void {
    for (const index of bitmap) {
      if (callback(index) === false) {
        break;
      }
    }
  }

  /**
   * Convert bitmap to array of indices
   */
  static toArray(bitmap: TypedFastBitSet): number[] {
    return bitmap.array();
  }

  /**
   * Sum values at bitmap positions (SIMD-accelerated when possible)
   */
  static sum<T extends NumericType>(
    bitmap: TypedFastBitSet,
    data: NumericValue<T>[],
    type: T
  ): NumericValue<T> {
    if (bitmap.isEmpty()) {
      return type.includes('64') ? 0n as NumericValue<T> : 0 as NumericValue<T>;
    }

    let sum: any = type.includes('64') ? 0n : 0;

    // For performance, batch process when bitmap is dense
    if (bitmap.size() / data.length > PERFORMANCE.BITMAP_DENSE_THRESHOLD) {
      return this.sumDense(bitmap, data, type);
    }

    // Sparse iteration
    for (const index of bitmap) {
      if (index < data.length) {
        const value = data[index];
        if (value !== undefined) {
          if (type.includes('64')) {
            sum += value as bigint;
          } else {
            sum += value as number;
          }
        }
      }
    }

    return sum;
  }

  /**
   * Find minimum value at bitmap positions
   */
  static min<T extends NumericType>(
    bitmap: TypedFastBitSet,
    data: NumericValue<T>[],
    type: T
  ): NumericValue<T> | undefined {
    if (bitmap.isEmpty()) {
      return undefined;
    }

    let min: NumericValue<T> | undefined = undefined;

    for (const index of bitmap) {
      if (index < data.length) {
        const value = data[index];
        if (value !== undefined) {
          if (min === undefined) {
            min = value;
          } else if (type.includes('64')) {
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
    }

    return min;
  }

  /**
   * Find maximum value at bitmap positions
   */
  static max<T extends NumericType>(
    bitmap: TypedFastBitSet,
    data: NumericValue<T>[],
    type: T
  ): NumericValue<T> | undefined {
    if (bitmap.isEmpty()) {
      return undefined;
    }

    let max: NumericValue<T> | undefined = undefined;

    for (const index of bitmap) {
      if (index < data.length) {
        const value = data[index];
        if (value !== undefined) {
          if (max === undefined) {
            max = value;
          } else if (type.includes('64')) {
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
    }

    return max;
  }

  /**
   * Calculate average of values at bitmap positions
   */
  static avg<T extends NumericType>(
    bitmap: TypedFastBitSet,
    data: NumericValue<T>[],
    type: T
  ): number {
    if (bitmap.isEmpty()) {
      return 0;
    }

    const sum = this.sum(bitmap, data, type);
    const count = bitmap.size();

    if (type.includes('64')) {
      return Number(sum as bigint) / count;
    } else {
      return (sum as number) / count;
    }
  }

  /**
   * Filter bitmap based on predicate function
   */
  static filter<T>(
    bitmap: TypedFastBitSet,
    data: T[],
    predicate: (value: T, index: number) => boolean
  ): TypedFastBitSet {
    const result = new TypedFastBitSet();

    for (const index of bitmap) {
      if (index < data.length) {
        const value = data[index];
        if (value !== undefined && predicate(value, index)) {
          result.add(index);
        }
      }
    }

    return result;
  }

  /**
   * Serialize bitmap to bytes
   */
  static serialize(bitmap: TypedFastBitSet): Uint8Array {
    // Simple serialization - in production, you might want to use a more efficient format
    const indices = bitmap.array();
    const buffer = new ArrayBuffer(4 + indices.length * 4);
    const view = new DataView(buffer);

    // Write length
    view.setUint32(0, indices.length, true);

    // Write indices
    for (let i = 0; i < indices.length; i++) {
      view.setUint32(4 + i * 4, indices[i], true);
    }

    return new Uint8Array(buffer);
  }

  /**
   * Deserialize bitmap from bytes
   */
  static deserialize(bytes: Uint8Array): TypedFastBitSet {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(0, true);

    const bitmap = new TypedFastBitSet();
    for (let i = 0; i < length; i++) {
      const index = view.getUint32(4 + i * 4, true);
      bitmap.add(index);
    }

    return bitmap;
  }

  /**
   * Optimized sum for dense bitmaps
   */
  private static sumDense<T extends NumericType>(
    bitmap: TypedFastBitSet,
    data: NumericValue<T>[],
    type: T
  ): NumericValue<T> {
    let sum: any = type.includes('64') ? 0n : 0;

    // Use typed array for better performance if possible
    const indices = bitmap.array();
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (index < data.length) {
        const value = data[index];
        if (value !== undefined) {
          if (type.includes('64')) {
            sum += value as bigint;
          } else {
            sum += value as number;
          }
        }
      }
    }

    return sum;
  }
}

/**
 * Bitmap pool for reusing bitmap instances to reduce GC pressure
 */
export class BitmapPool {
  private static pools = new Map<number, TypedFastBitSet[]>();

  /**
   * Get a bitmap from the pool or create a new one
   */
  static acquire(capacity: number = CHUNK_SIZE): TypedFastBitSet {
    const pool = this.pools.get(capacity);
    if (pool && pool.length > 0) {
      const bitmap = pool.pop()!;
      bitmap.trim(); // Ensure it's clean
      return bitmap;
    }
    return new TypedFastBitSet();
  }

  /**
   * Return a bitmap to the pool for reuse
   */
  static release(bitmap: TypedFastBitSet, capacity: number = CHUNK_SIZE): void {
    // Clear the bitmap before releasing
    bitmap.clear();
    
    // Pool the now-empty bitmap
    let pool = this.pools.get(capacity);
    if (!pool) {
      pool = [];
      this.pools.set(capacity, pool);
    }
    if (pool.length < 16) { // Limit pool size
      pool.push(bitmap);
    }
  }

  /**
   * Clear all pools
   */
  static clear(): void {
    this.pools.clear();
  }
}
