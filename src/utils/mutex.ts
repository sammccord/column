import { SHARD_COUNT, LOCK_TIMEOUT_MS } from '../constants.js';

/**
 * Lock state constants for atomic operations
 */
const UNLOCKED = 0;
const WRITE_LOCKED = 1;
const READ_LOCKED_BASE = 2; // Read locks count from 2 upwards

/**
 * Sharded mutex implementation using SharedArrayBuffer and Atomics
 * Replaces Go's smutex.SMutex128 functionality
 */
export class ShardedMutex {
  private locks: SharedArrayBuffer;
  private lockArray: Int32Array;
  private shardCount: number;

  constructor(shardCount: number = SHARD_COUNT) {
    this.shardCount = shardCount;
    
    // Create shared buffer for lock states (4 bytes per shard)
    this.locks = new SharedArrayBuffer(shardCount * 4);
    this.lockArray = new Int32Array(this.locks);
    
    // Initialize all locks to unlocked state
    for (let i = 0; i < shardCount; i++) {
      Atomics.store(this.lockArray, i, UNLOCKED);
    }
  }

  /**
   * Get the shard index for a given key
   */
  private getShardIndex(key: number): number {
    // Ensure positive result even for negative keys
    return Math.abs(key) % this.shardCount;
  }

  /**
   * Acquire a read lock on the shard for the given key
   */
  async rlock(key: number): Promise<void> {
    const shardIndex = this.getShardIndex(key);
    const startTime = Date.now();

    while (true) {
      const currentValue = Atomics.load(this.lockArray, shardIndex);
      
      // If write locked, wait
      if (currentValue === WRITE_LOCKED) {
        if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
          throw new Error(`Read lock timeout for shard ${shardIndex}`);
        }
        
        // Wait for notification or timeout
        const result = Atomics.wait(this.lockArray, shardIndex, WRITE_LOCKED, 10);
        if (result === 'timed-out') {
          continue;
        }
        continue;
      }
      
      // Try to increment read lock count
      const newValue = currentValue === UNLOCKED ? READ_LOCKED_BASE : currentValue + 1;
      const exchanged = Atomics.compareExchange(this.lockArray, shardIndex, currentValue, newValue);
      
      if (exchanged === currentValue) {
        // Successfully acquired read lock
        return;
      }
      
      // CAS failed, retry
      await this.yieldThread();
    }
  }

  /**
   * Release a read lock on the shard for the given key
   */
  runlock(key: number): void {
    const shardIndex = this.getShardIndex(key);
    
    while (true) {
      const currentValue = Atomics.load(this.lockArray, shardIndex);
      
      if (currentValue < READ_LOCKED_BASE) {
        throw new Error(`Attempting to release read lock on unlocked shard ${shardIndex}`);
      }
      
      const newValue = currentValue === READ_LOCKED_BASE ? UNLOCKED : currentValue - 1;
      const exchanged = Atomics.compareExchange(this.lockArray, shardIndex, currentValue, newValue);
      
      if (exchanged === currentValue) {
        // If we just unlocked completely, notify waiting writers
        if (newValue === UNLOCKED) {
          Atomics.notify(this.lockArray, shardIndex, 1);
        }
        return;
      }
      
      // CAS failed, retry
    }
  }

  /**
   * Acquire a write lock on the shard for the given key
   */
  async lock(key: number): Promise<void> {
    const shardIndex = this.getShardIndex(key);
    const startTime = Date.now();

    while (true) {
      // Try to acquire write lock (only possible if currently unlocked)
      const exchanged = Atomics.compareExchange(this.lockArray, shardIndex, UNLOCKED, WRITE_LOCKED);
      
      if (exchanged === UNLOCKED) {
        // Successfully acquired write lock
        return;
      }
      
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
        throw new Error(`Write lock timeout for shard ${shardIndex}`);
      }
      
      // Wait for lock to become available
      const result = Atomics.wait(this.lockArray, shardIndex, exchanged, 10);
      if (result === 'timed-out') {
        continue;
      }
      
      await this.yieldThread();
    }
  }

  /**
   * Release a write lock on the shard for the given key
   */
  unlock(key: number): void {
    const shardIndex = this.getShardIndex(key);
    
    const exchanged = Atomics.compareExchange(this.lockArray, shardIndex, WRITE_LOCKED, UNLOCKED);
    
    if (exchanged !== WRITE_LOCKED) {
      throw new Error(`Attempting to release write lock on non-write-locked shard ${shardIndex}`);
    }
    
    // Notify all waiting threads
    Atomics.notify(this.lockArray, shardIndex);
  }

  /**
   * Try to acquire a read lock without blocking
   */
  tryRLock(key: number): boolean {
    const shardIndex = this.getShardIndex(key);
    const currentValue = Atomics.load(this.lockArray, shardIndex);
    
    // Can't acquire read lock if write locked
    if (currentValue === WRITE_LOCKED) {
      return false;
    }
    
    const newValue = currentValue === UNLOCKED ? READ_LOCKED_BASE : currentValue + 1;
    const exchanged = Atomics.compareExchange(this.lockArray, shardIndex, currentValue, newValue);
    
    return exchanged === currentValue;
  }

  /**
   * Try to acquire a write lock without blocking
   */
  tryLock(key: number): boolean {
    const shardIndex = this.getShardIndex(key);
    const exchanged = Atomics.compareExchange(this.lockArray, shardIndex, UNLOCKED, WRITE_LOCKED);
    return exchanged === UNLOCKED;
  }

  /**
   * Get the current state of a shard (for debugging)
   */
  getShardState(key: number): 'unlocked' | 'write-locked' | 'read-locked' {
    const shardIndex = this.getShardIndex(key);
    const value = Atomics.load(this.lockArray, shardIndex);
    
    if (value === UNLOCKED) return 'unlocked';
    if (value === WRITE_LOCKED) return 'write-locked';
    return 'read-locked';
  }

  /**
   * Get the read lock count for a shard (for debugging)
   */
  getReadLockCount(key: number): number {
    const shardIndex = this.getShardIndex(key);
    const value = Atomics.load(this.lockArray, shardIndex);
    
    if (value < READ_LOCKED_BASE) return 0;
    return value - READ_LOCKED_BASE + 1;
  }

  /**
   * Get statistics about all shards
   */
  getStats(): {
    totalShards: number;
    unlockedShards: number;
    writeLockedShards: number;
    readLockedShards: number;
    totalReadLocks: number;
  } {
    let unlocked = 0;
    let writeLocked = 0;
    let readLocked = 0;
    let totalReadLocks = 0;

    for (let i = 0; i < this.shardCount; i++) {
      const value = Atomics.load(this.lockArray, i);
      
      if (value === UNLOCKED) {
        unlocked++;
      } else if (value === WRITE_LOCKED) {
        writeLocked++;
      } else {
        readLocked++;
        totalReadLocks += value - READ_LOCKED_BASE + 1;
      }
    }

    return {
      totalShards: this.shardCount,
      unlockedShards: unlocked,
      writeLockedShards: writeLocked,
      readLockedShards: readLocked,
      totalReadLocks
    };
  }

  /**
   * Yield execution to other threads/tasks
   */
  private async yieldThread(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * RAII-style lock guard for automatic lock management
 */
export class LockGuard {
  private mutex: ShardedMutex;
  private key: number;
  private isWrite: boolean;
  private acquired: boolean = false;

  constructor(mutex: ShardedMutex, key: number, isWrite: boolean = false) {
    this.mutex = mutex;
    this.key = key;
    this.isWrite = isWrite;
  }

  /**
   * Acquire the lock
   */
  async acquire(): Promise<void> {
    if (this.acquired) {
      throw new Error('Lock already acquired');
    }
    
    if (this.isWrite) {
      await this.mutex.lock(this.key);
    } else {
      await this.mutex.rlock(this.key);
    }
    
    this.acquired = true;
  }

  /**
   * Release the lock
   */
  release(): void {
    if (!this.acquired) {
      return;
    }
    
    if (this.isWrite) {
      this.mutex.unlock(this.key);
    } else {
      this.mutex.runlock(this.key);
    }
    
    this.acquired = false;
  }

  /**
   * Execute a function with the lock held
   */
  static async withLock<T>(
    mutex: ShardedMutex,
    key: number,
    isWrite: boolean,
    fn: () => T | Promise<T>
  ): Promise<T> {
    const guard = new LockGuard(mutex, key, isWrite);
    
    try {
      await guard.acquire();
      return await fn();
    } finally {
      guard.release();
    }
  }

  /**
   * Execute a function with a read lock
   */
  static async withReadLock<T>(
    mutex: ShardedMutex,
    key: number,
    fn: () => T | Promise<T>
  ): Promise<T> {
    return this.withLock(mutex, key, false, fn);
  }

  /**
   * Execute a function with a write lock
   */
  static async withWriteLock<T>(
    mutex: ShardedMutex,
    key: number,
    fn: () => T | Promise<T>
  ): Promise<T> {
    return this.withLock(mutex, key, true, fn);
  }
}

/**
 * Simple non-sharded mutex for cases where sharding isn't needed
 */
export class SimpleMutex {
  private lock: SharedArrayBuffer;
  private lockArray: Int32Array;

  constructor() {
    this.lock = new SharedArrayBuffer(4);
    this.lockArray = new Int32Array(this.lock);
    Atomics.store(this.lockArray, 0, UNLOCKED);
  }

  async acquire(): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const exchanged = Atomics.compareExchange(this.lockArray, 0, UNLOCKED, WRITE_LOCKED);
      
      if (exchanged === UNLOCKED) {
        return;
      }
      
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
        throw new Error('Simple mutex lock timeout');
      }
      
      const result = Atomics.wait(this.lockArray, 0, WRITE_LOCKED, 10);
      if (result === 'timed-out') {
        continue;
      }
      
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  release(): void {
    const exchanged = Atomics.compareExchange(this.lockArray, 0, WRITE_LOCKED, UNLOCKED);
    
    if (exchanged !== WRITE_LOCKED) {
      throw new Error('Attempting to release unlocked simple mutex');
    }
    
    Atomics.notify(this.lockArray, 0);
  }

  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    try {
      await this.acquire();
      return await fn();
    } finally {
      this.release();
    }
  }
}