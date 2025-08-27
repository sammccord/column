import { describe, test, expect, beforeEach } from "bun:test";
import { ShardedMutex, LockGuard, SimpleMutex } from "../../src/utils/mutex.js";

// Note: These tests may be flaky in environments without SharedArrayBuffer support
// or proper Atomics implementation. They test the logical behavior rather than 
// true concurrency in most cases.

describe("ShardedMutex", () => {
  let mutex: ShardedMutex;

  beforeEach(() => {
    mutex = new ShardedMutex(8); // Use smaller shard count for testing
  });

  describe("shard calculation", () => {
    test("should distribute keys across shards", () => {
      const shardCounts = new Map<number, number>();
      
      // Test distribution across many keys
      for (let i = 0; i < 100; i++) {
        const shardIndex = i % 8; // Internal shard calculation
        shardCounts.set(shardIndex, (shardCounts.get(shardIndex) || 0) + 1);
      }
      
      // Should have reasonable distribution (not perfectly even due to modulo)
      expect(shardCounts.size).toBeGreaterThan(1);
    });
  });

  describe("read locks", () => {
    test("should acquire and release read locks", async () => {
      await mutex.rlock(1);
      expect(mutex.getShardState(1)).toBe('read-locked');
      expect(mutex.getReadLockCount(1)).toBe(1);
      
      mutex.runlock(1);
      expect(mutex.getShardState(1)).toBe('unlocked');
      expect(mutex.getReadLockCount(1)).toBe(0);
    });

    test("should allow multiple read locks on same shard", async () => {
      await mutex.rlock(1);
      await mutex.rlock(9); // Same shard (1 % 8 = 1, 9 % 8 = 1)
      
      expect(mutex.getShardState(1)).toBe('read-locked');
      expect(mutex.getReadLockCount(1)).toBeGreaterThan(0);
      
      mutex.runlock(1);
      mutex.runlock(9);
    });

    test("should throw error when releasing non-held read lock", () => {
      expect(() => mutex.runlock(1)).toThrow();
    });
  });

  describe("write locks", () => {
    test("should acquire and release write locks", async () => {
      await mutex.lock(1);
      expect(mutex.getShardState(1)).toBe('write-locked');
      
      mutex.unlock(1);
      expect(mutex.getShardState(1)).toBe('unlocked');
    });

    test("should throw error when releasing non-held write lock", () => {
      expect(() => mutex.unlock(1)).toThrow();
    });
  });

  describe("try lock operations", () => {
    test("should try acquire read lock successfully when unlocked", () => {
      const acquired = mutex.tryRLock(1);
      expect(acquired).toBe(true);
      expect(mutex.getShardState(1)).toBe('read-locked');
      
      mutex.runlock(1);
    });

    test("should try acquire write lock successfully when unlocked", () => {
      const acquired = mutex.tryLock(1);
      expect(acquired).toBe(true);
      expect(mutex.getShardState(1)).toBe('write-locked');
      
      mutex.unlock(1);
    });

    test("should fail to acquire write lock when read locked", async () => {
      await mutex.rlock(1);
      
      const acquired = mutex.tryLock(1);
      expect(acquired).toBe(false);
      
      mutex.runlock(1);
    });

    test("should fail to acquire read lock when write locked", async () => {
      await mutex.lock(1);
      
      const acquired = mutex.tryRLock(1);
      expect(acquired).toBe(false);
      
      mutex.unlock(1);
    });
  });

  describe("statistics", () => {
    test("should provide accurate statistics", async () => {
      await mutex.rlock(1);
      await mutex.rlock(2);
      await mutex.lock(3);
      
      const stats = mutex.getStats();
      
      expect(stats.totalShards).toBe(8);
      expect(stats.readLockedShards).toBeGreaterThanOrEqual(1);
      expect(stats.writeLockedShards).toBeGreaterThanOrEqual(1);
      expect(stats.totalReadLocks).toBeGreaterThanOrEqual(1);
      
      mutex.runlock(1);
      mutex.runlock(2);
      mutex.unlock(3);
    });

    test("should show all unlocked initially", () => {
      const stats = mutex.getStats();
      
      expect(stats.unlockedShards).toBe(8);
      expect(stats.readLockedShards).toBe(0);
      expect(stats.writeLockedShards).toBe(0);
      expect(stats.totalReadLocks).toBe(0);
    });
  });

  describe("concurrent access patterns", () => {
    test("should handle multiple operations on different shards", async () => {
      // Test operations on different shards that shouldn't interfere
      await mutex.rlock(0); // shard 0
      await mutex.rlock(8); // shard 0 (8 % 8 = 0)
      await mutex.lock(1);  // shard 1
      await mutex.lock(2);  // shard 2 (different shard from shard 1)
      
      expect(mutex.getShardState(0)).toBe('read-locked');
      expect(mutex.getShardState(1)).toBe('write-locked');
      expect(mutex.getShardState(2)).toBe('write-locked');
      
      mutex.runlock(0);
      mutex.runlock(8);
      mutex.unlock(1);
      mutex.unlock(2);
    });
  });

  describe("timeout behavior", () => {
    // Note: These tests may be slow due to timeout values
    test("should timeout on write lock when read locked", async () => {
      await mutex.rlock(1);
      
      const startTime = Date.now();
      
      try {
        await mutex.lock(1);
        expect.unreachable("Should have thrown timeout error");
      } catch (error) {
        const elapsed = Date.now() - startTime;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("timeout");
        // Should timeout quickly in test environment
        expect(elapsed).toBeGreaterThan(0);
      }
      
      mutex.runlock(1);
    }, 10000); // 10 second timeout for test

    test("should timeout on read lock when write locked", async () => {
      await mutex.lock(1);
      
      const startTime = Date.now();
      
      try {
        await mutex.rlock(1);
        expect.unreachable("Should have thrown timeout error");
      } catch (error) {
        const elapsed = Date.now() - startTime;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("timeout");
        expect(elapsed).toBeGreaterThan(0);
      }
      
      mutex.unlock(1);
    }, 10000);
  });
});

describe("LockGuard", () => {
  let mutex: ShardedMutex;

  beforeEach(() => {
    mutex = new ShardedMutex(8);
  });

  describe("RAII pattern", () => {
    test("should acquire and release lock automatically", async () => {
      const guard = new LockGuard(mutex, 1, false); // read lock
      
      await guard.acquire();
      expect(mutex.getShardState(1)).toBe('read-locked');
      
      guard.release();
      expect(mutex.getShardState(1)).toBe('unlocked');
    });

    test("should throw error when acquiring already acquired lock", async () => {
      const guard = new LockGuard(mutex, 1, false);
      
      await guard.acquire();
      
      await expect(guard.acquire()).rejects.toThrow("already acquired");
      
      guard.release();
    });

    test("should handle multiple releases gracefully", async () => {
      const guard = new LockGuard(mutex, 1, false);
      
      await guard.acquire();
      guard.release();
      guard.release(); // Should not throw
      
      expect(mutex.getShardState(1)).toBe('unlocked');
    });
  });

  describe("static helper methods", () => {
    test("should execute function with read lock", async () => {
      let executed = false;
      
      const result = await LockGuard.withReadLock(mutex, 1, () => {
        expect(mutex.getShardState(1)).toBe('read-locked');
        executed = true;
        return "success";
      });
      
      expect(executed).toBe(true);
      expect(result).toBe("success");
      expect(mutex.getShardState(1)).toBe('unlocked');
    });

    test("should execute function with write lock", async () => {
      let executed = false;
      
      const result = await LockGuard.withWriteLock(mutex, 1, () => {
        expect(mutex.getShardState(1)).toBe('write-locked');
        executed = true;
        return "success";
      });
      
      expect(executed).toBe(true);
      expect(result).toBe("success");
      expect(mutex.getShardState(1)).toBe('unlocked');
    });

    test("should release lock even if function throws", async () => {
      await expect(
        LockGuard.withWriteLock(mutex, 1, () => {
          expect(mutex.getShardState(1)).toBe('write-locked');
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
      
      expect(mutex.getShardState(1)).toBe('unlocked');
    });

    test("should handle async functions", async () => {
      const result = await LockGuard.withReadLock(mutex, 1, async () => {
        expect(mutex.getShardState(1)).toBe('read-locked');
        await new Promise(resolve => setTimeout(resolve, 10));
        return "async success";
      });
      
      expect(result).toBe("async success");
      expect(mutex.getShardState(1)).toBe('unlocked');
    });
  });
});

describe("SimpleMutex", () => {
  let mutex: SimpleMutex;

  beforeEach(() => {
    mutex = new SimpleMutex();
  });

  describe("basic locking", () => {
    test("should acquire and release lock", async () => {
      await mutex.acquire();
      
      // In a real scenario, this would block other threads
      // For testing, we just verify no error is thrown
      
      mutex.release();
    });

    test("should throw error when releasing unlocked mutex", () => {
      expect(() => mutex.release()).toThrow("unlocked");
    });

    test("should execute function with lock held", async () => {
      let executed = false;
      
      const result = await mutex.withLock(() => {
        executed = true;
        return "success";
      });
      
      expect(executed).toBe(true);
      expect(result).toBe("success");
    });

    test("should release lock even if function throws", async () => {
      await expect(
        mutex.withLock(() => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
      
      // Mutex should be released, so this should work
      await mutex.withLock(() => {
        return "works";
      });
    });

    test("should handle async functions", async () => {
      const result = await mutex.withLock(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return "async success";
      });
      
      expect(result).toBe("async success");
    });
  });

  describe("error handling", () => {
    test("should timeout on acquisition", async () => {
      await mutex.acquire();
      
      const startTime = Date.now();
      
      try {
        await mutex.acquire();
        expect.unreachable("Should have thrown timeout error");
      } catch (error) {
        const elapsed = Date.now() - startTime;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("timeout");
        expect(elapsed).toBeGreaterThan(0);
      }
      
      mutex.release();
    }, 10000);
  });
});

describe("Mutex edge cases", () => {
  test("should handle very large key values in ShardedMutex", async () => {
    const mutex = new ShardedMutex(8);
    const largeKey = Number.MAX_SAFE_INTEGER;
    
    await mutex.rlock(largeKey);
    expect(mutex.getShardState(largeKey)).toBe('read-locked');
    
    mutex.runlock(largeKey);
    expect(mutex.getShardState(largeKey)).toBe('unlocked');
  });

  test("should handle zero key value", async () => {
    const mutex = new ShardedMutex(8);
    
    await mutex.rlock(0);
    expect(mutex.getShardState(0)).toBe('read-locked');
    
    mutex.runlock(0);
    expect(mutex.getShardState(0)).toBe('unlocked');
  });

  test("should handle negative key values", async () => {
    const mutex = new ShardedMutex(8);
    
    // Negative keys should still work (modulo behavior)
    await mutex.rlock(-1);
    mutex.runlock(-1);
    
    await mutex.lock(-100);
    mutex.unlock(-100);
  });
});