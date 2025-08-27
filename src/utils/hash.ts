import { HASH_SEED } from '../constants.js';

/**
 * Hash utilities using Bun's native hashing APIs
 * Replaces functionality from github.com/zeebo/xxh3
 */
export class HashUtils {
  /**
   * Hash a string using xxHash3 (via Bun.hash.xxHash3)
   */
  static hashString(input: string, seed: number = HASH_SEED): number {
    // Convert string to Uint8Array for hashing
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);

    // Use Bun's xxHash3 implementation
    const hash64 = Bun.hash.xxHash3(bytes, BigInt(seed));

    // Convert BigInt to 32-bit number for compatibility
    return Number(hash64 & 0xFFFFFFFFn);
  }

  /**
   * Hash bytes using xxHash3
   */
  static hashBytes(input: Uint8Array, seed: number = HASH_SEED): number {
    const hash64 = Bun.hash.xxHash3(input, BigInt(seed));
    return Number(hash64 & 0xFFFFFFFFn);
  }

  /**
   * Hash any serializable value
   */
  static hashValue(value: any, seed: number = HASH_SEED): number {
    let bytes: Uint8Array;

    if (typeof value === 'string') {
      const encoder = new TextEncoder();
      bytes = encoder.encode(value);
    } else if (value instanceof Uint8Array) {
      bytes = value;
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      // Serialize complex objects to JSON then hash
      const json = JSON.stringify(value);
      const encoder = new TextEncoder();
      bytes = encoder.encode(json);
    }

    return this.hashBytes(bytes, seed);
  }

  /**
   * Generate a 64-bit hash (returns BigInt)
   */
  static hash64(input: string | Uint8Array, seed: number = HASH_SEED): bigint {
    let bytes: Uint8Array;

    if (typeof input === 'string') {
      const encoder = new TextEncoder();
      bytes = encoder.encode(input);
    } else {
      bytes = input;
    }

    return Bun.hash.xxHash3(bytes, BigInt(seed));
  }

  /**
   * Fast hash for small integers (combines multiple values)
   */
  static combineHashes(...hashes: number[]): number {
    let result = HASH_SEED;

    for (const hash of hashes) {
      // Simple hash combining algorithm
      result ^= hash + 0x9e3779b9 + (result << 6) + (result >> 2);
    }

    return result >>> 0; // Ensure unsigned 32-bit
  }

  /**
   * Hash a numeric value
   */
  static hashNumber(value: number, seed: number = HASH_SEED): number {
    // Convert number to bytes for consistent hashing
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, true); // little-endian

    return this.hashBytes(new Uint8Array(buffer), seed);
  }

  /**
   * Hash a BigInt value
   */
  static hashBigInt(value: bigint, seed: number = HASH_SEED): number {
    // Convert BigInt to bytes
    const bytes = this.bigIntToBytes(value);
    return this.hashBytes(bytes, seed);
  }

  /**
   * Create a consistent hash for any JavaScript value
   */
  static universalHash(value: any, seed: number = HASH_SEED): number {
    const type = typeof value;

    switch (type) {
      case 'string':
        return this.hashString(value, seed);

      case 'number':
        return this.hashNumber(value, seed);

      case 'bigint':
        return this.hashBigInt(value, seed);

      case 'boolean':
        return this.hashString(value.toString(), seed);

      case 'undefined':
        return this.hashString('undefined', seed);

      case 'object':
        if (value === null) {
          return this.hashString('null', seed);
        }
        if (value instanceof Date) {
          return this.hashNumber(value.getTime(), seed);
        }
        if (value instanceof Uint8Array) {
          return this.hashBytes(value, seed);
        }
        // Fallback to JSON serialization
        return this.hashValue(value, seed);

      default:
        return this.hashString(String(value), seed);
    }
  }

  /**
   * Create a hash table key from multiple values
   */
  static createKey(...values: any[]): string {
    const hashes = values.map(v => this.universalHash(v));
    return hashes.join(':');
  }

  /**
   * Convert BigInt to byte array for hashing
   */
  private static bigIntToBytes(value: bigint): Uint8Array {
    const bytes: number[] = [];
    let n = value < 0n ? -value : value;

    if (n === 0n) {
      return new Uint8Array([0]);
    }

    while (n > 0n) {
      bytes.push(Number(n & 0xFFn));
      n >>= 8n;
    }

    // Add sign bit if negative
    if (value < 0n) {
      bytes.push(0xFF);
    }

    return new Uint8Array(bytes);
  }
}

/**
 * Simple hash map implementation for string deduplication (enum columns)
 */
export class HashStringMap {
  private map = new Map<number, { value: string; index: number }>();
  private strings: string[] = [];
  private seed: number;

  constructor(seed: number = HASH_SEED) {
    this.seed = seed;
  }

  /**
   * Find existing string or add new one, returns index
   */
  findOrAdd(value: string): number {
    const hash = HashUtils.hashString(value, this.seed);

    // Check if we already have this hash
    const existing = this.map.get(hash);
    if (existing && existing.value === value) {
      return existing.index;
    }

    // Handle hash collision by checking actual string value
    for (const [existingHash, data] of this.map.entries()) {
      if (data.value === value) {
        // Update hash mapping for faster future lookups
        this.map.set(hash, data);
        return data.index;
      }
    }

    // Add new string
    const index = this.strings.length;
    this.strings.push(value);
    this.map.set(hash, { value, index });

    return index;
  }

  /**
   * Get string by index
   */
  getString(index: number): string | undefined {
    return this.strings[index];
  }

  /**
   * Get number of unique strings
   */
  size(): number {
    return this.strings.length;
  }

  /**
   * Get all strings
   */
  getStrings(): readonly string[] {
    return this.strings;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.map.clear();
    this.strings.length = 0;
  }

  /**
   * Clone this string map
   */
  clone(): HashStringMap {
    const cloned = new HashStringMap(this.seed);
    cloned.strings = [...this.strings];
    cloned.map = new Map(this.map);
    return cloned;
  }

  /**
   * Get memory usage statistics
   */
  getStats(): {
    uniqueStrings: number;
    totalLength: number;
    hashCollisions: number;
  } {
    let totalLength = 0;
    for (const str of this.strings) {
      totalLength += str.length;
    }

    // Estimate hash collisions (simplified)
    const hashCollisions = this.strings.length - this.map.size;

    return {
      uniqueStrings: this.strings.length,
      totalLength,
      hashCollisions: Math.max(0, hashCollisions)
    };
  }
}
