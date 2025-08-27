// Core constants for the column store

// Chunk and memory management
export const CHUNK_SIZE = 16384;           // 16K elements per chunk (cache-friendly size)
export const SHARD_COUNT = 128;            // Number of mutex shards for concurrency
export const INITIAL_CAPACITY = 1024;      // Initial capacity for collections
export const GROWTH_FACTOR = 1.5;          // Growth factor for dynamic resizing

// Serialization format
export const FORMAT_VERSION = 1;           // Current binary format version
export const MAGIC_HEADER = 0x434F4C554D; // "COLUM" in hex
export const COMPRESSION_THRESHOLD = 1024; // Minimum size for compression

// Hash and index constants
export const HASH_SEED = 0x9e3779b9;      // Default hash seed
export const INDEX_LOAD_FACTOR = 0.75;    // Hash table load factor
export const ENUM_INITIAL_SIZE = 64;      // Initial enum dictionary size

// Transaction and concurrency
export const MAX_TRANSACTION_DEPTH = 32;   // Maximum nested transaction depth
export const LOCK_TIMEOUT_MS = 5000;      // Lock acquisition timeout
export const POOL_SIZE = 16;              // Object pool size for transactions

// Column type byte codes for serialization
export const COLUMN_TYPE_CODES = {
  INT8: 0x01,
  INT16: 0x02,
  INT32: 0x03,
  INT64: 0x04,
  UINT8: 0x05,
  UINT16: 0x06,
  UINT32: 0x07,
  UINT64: 0x08,
  FLOAT32: 0x09,
  FLOAT64: 0x0A,
  STRING: 0x0B,
  ENUM: 0x0C,
  BOOLEAN: 0x0D,
  RECORD: 0x0E,
  KEY: 0x0F,
  INDEX: 0x10,
  SORT_INDEX: 0x11,
} as const;

// Numeric type metadata
export const NUMERIC_TYPE_INFO = {
  int8: { byteSize: 1, signed: true, isFloat: false, arrayType: Int8Array },
  int16: { byteSize: 2, signed: true, isFloat: false, arrayType: Int16Array },
  int32: { byteSize: 4, signed: true, isFloat: false, arrayType: Int32Array },
  int64: { byteSize: 8, signed: true, isFloat: false, arrayType: BigInt64Array },
  uint8: { byteSize: 1, signed: false, isFloat: false, arrayType: Uint8Array },
  uint16: { byteSize: 2, signed: false, isFloat: false, arrayType: Uint16Array },
  uint32: { byteSize: 4, signed: false, isFloat: false, arrayType: Uint32Array },
  uint64: { byteSize: 8, signed: false, isFloat: false, arrayType: BigUint64Array },
  float32: { byteSize: 4, signed: true, isFloat: true, arrayType: Float32Array },
  float64: { byteSize: 8, signed: true, isFloat: true, arrayType: Float64Array },
} as const;

// Error messages
export const ERROR_MESSAGES = {
  COLUMN_NOT_FOUND: (name: string) => `Column '${name}' not found`,
  COLUMN_EXISTS: (name: string) => `Column '${name}' already exists`,
  INDEX_NOT_FOUND: (name: string) => `Index '${name}' not found`,
  INDEX_EXISTS: (name: string) => `Index '${name}' already exists`,
  INVALID_COLUMN_TYPE: (type: string) => `Invalid column type: ${type}`,
  INVALID_INDEX: (index: number) => `Invalid index: ${index}`,
  TRANSACTION_NOT_STARTED: 'Transaction not started',
  TRANSACTION_ALREADY_STARTED: 'Transaction already started',
  COLLECTION_FROZEN: 'Collection is frozen and cannot be modified',
  INCOMPATIBLE_TYPE: (expected: string, actual: string) => 
    `Type mismatch: expected ${expected}, got ${actual}`,
  CHUNK_OUT_OF_BOUNDS: (chunkId: number) => `Chunk ${chunkId} is out of bounds`,
  SERIALIZATION_FAILED: 'Serialization failed',
  DESERIALIZATION_FAILED: 'Deserialization failed',
  LOCK_TIMEOUT: 'Lock acquisition timeout',
} as const;

// Performance tuning constants
export const PERFORMANCE = {
  // SIMD batch size for operations
  SIMD_BATCH_SIZE: 64,
  
  // Bitmap operation thresholds
  BITMAP_DENSE_THRESHOLD: 0.5,
  
  // String interning threshold
  STRING_INTERN_THRESHOLD: 32,
  
  // Aggregation buffer sizes
  AGG_BUFFER_SIZE: 1024,
  
  // Memory pool sizes
  SMALL_BUFFER_SIZE: 256,
  MEDIUM_BUFFER_SIZE: 1024,
  LARGE_BUFFER_SIZE: 4096,
} as const;

// Export individual constants for convenience
export const STRING_INTERN_THRESHOLD = PERFORMANCE.STRING_INTERN_THRESHOLD;

// Feature flags
export const FEATURES = {
  ENABLE_SIMD: true,
  ENABLE_COMPRESSION: true,
  ENABLE_CDC: false,
  ENABLE_STATISTICS: true,
  ENABLE_PROFILING: false,
} as const;