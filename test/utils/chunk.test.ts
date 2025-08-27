import { describe, test, expect, beforeEach } from "bun:test";
import { ChunkUtils, ChunkManager } from "../../src/utils/chunk.js";
import { CHUNK_SIZE } from "../../src/constants.js";

describe("ChunkUtils", () => {
  describe("chunk calculations", () => {
    test("chunkAt should calculate correct chunk ID", () => {
      expect(ChunkUtils.chunkAt(0)).toBe(0);
      expect(ChunkUtils.chunkAt(1000)).toBe(0);
      expect(ChunkUtils.chunkAt(CHUNK_SIZE - 1)).toBe(0);
      expect(ChunkUtils.chunkAt(CHUNK_SIZE)).toBe(1);
      expect(ChunkUtils.chunkAt(CHUNK_SIZE + 1000)).toBe(1);
      expect(ChunkUtils.chunkAt(CHUNK_SIZE * 2)).toBe(2);
    });

    test("localIndex should calculate correct local index", () => {
      expect(ChunkUtils.localIndex(0)).toBe(0);
      expect(ChunkUtils.localIndex(1000)).toBe(1000);
      expect(ChunkUtils.localIndex(CHUNK_SIZE - 1)).toBe(CHUNK_SIZE - 1);
      expect(ChunkUtils.localIndex(CHUNK_SIZE)).toBe(0);
      expect(ChunkUtils.localIndex(CHUNK_SIZE + 1000)).toBe(1000);
      expect(ChunkUtils.localIndex(CHUNK_SIZE * 2 + 500)).toBe(500);
    });

    test("chunkStart should calculate correct start index", () => {
      expect(ChunkUtils.chunkStart(0)).toBe(0);
      expect(ChunkUtils.chunkStart(1)).toBe(CHUNK_SIZE);
      expect(ChunkUtils.chunkStart(2)).toBe(CHUNK_SIZE * 2);
      expect(ChunkUtils.chunkStart(10)).toBe(CHUNK_SIZE * 10);
    });

    test("chunkEnd should calculate correct end index", () => {
      expect(ChunkUtils.chunkEnd(0)).toBe(CHUNK_SIZE);
      expect(ChunkUtils.chunkEnd(1)).toBe(CHUNK_SIZE * 2);
      expect(ChunkUtils.chunkEnd(2)).toBe(CHUNK_SIZE * 3);
    });
  });

  describe("chunk ranges", () => {
    test("chunkRange should calculate correct range", () => {
      const range1 = ChunkUtils.chunkRange(0, 1000);
      expect(range1.start).toBe(0);
      expect(range1.end).toBe(0);

      const range2 = ChunkUtils.chunkRange(0, CHUNK_SIZE * 2 + 1000);
      expect(range2.start).toBe(0);
      expect(range2.end).toBe(2);

      const range3 = ChunkUtils.chunkRange(CHUNK_SIZE + 500, CHUNK_SIZE * 3 + 200);
      expect(range3.start).toBe(1);
      expect(range3.end).toBe(3);
    });

    test("getIntersectingChunks should return correct chunk IDs", () => {
      const chunks1 = ChunkUtils.getIntersectingChunks(0, 1000);
      expect(chunks1).toEqual([0]);

      const chunks2 = ChunkUtils.getIntersectingChunks(0, CHUNK_SIZE * 2 + 1000);
      expect(chunks2).toEqual([0, 1, 2]);

      const chunks3 = ChunkUtils.getIntersectingChunks(CHUNK_SIZE + 500, CHUNK_SIZE * 2 + 200);
      expect(chunks3).toEqual([1, 2]);
    });
  });

  describe("metadata creation", () => {
    test("createMetadata should create correct metadata", () => {
      const metadata = ChunkUtils.createMetadata(5);
      
      expect(metadata.id).toBe(5);
      expect(metadata.startIndex).toBe(CHUNK_SIZE * 5);
      expect(metadata.endIndex).toBe(CHUNK_SIZE * 6);
      expect(metadata.isDirty).toBe(false);
      expect(metadata.commitId).toBe(0n);
    });
  });

  describe("validation", () => {
    test("isValidIndex should validate local indices correctly", () => {
      expect(ChunkUtils.isValidIndex(0, 0)).toBe(true);
      expect(ChunkUtils.isValidIndex(0, CHUNK_SIZE - 1)).toBe(true);
      expect(ChunkUtils.isValidIndex(0, CHUNK_SIZE)).toBe(false);
      expect(ChunkUtils.isValidIndex(0, -1)).toBe(false);
    });
  });

  describe("chunk intersection", () => {
    test("chunkIntersection should calculate correct intersection", () => {
      // Intersection within chunk bounds
      const intersection1 = ChunkUtils.chunkIntersection(0, 1000, 2000);
      expect(intersection1).not.toBeNull();
      expect(intersection1!.localStart).toBe(1000);
      expect(intersection1!.localEnd).toBe(2000);
      expect(intersection1!.globalStart).toBe(1000);
      expect(intersection1!.globalEnd).toBe(2000);

      // Intersection across chunk boundary
      const intersection2 = ChunkUtils.chunkIntersection(0, CHUNK_SIZE - 500, CHUNK_SIZE + 500);
      expect(intersection2).not.toBeNull();
      expect(intersection2!.localStart).toBe(CHUNK_SIZE - 500);
      expect(intersection2!.localEnd).toBe(CHUNK_SIZE);
      expect(intersection2!.globalStart).toBe(CHUNK_SIZE - 500);
      expect(intersection2!.globalEnd).toBe(CHUNK_SIZE);

      // No intersection
      const intersection3 = ChunkUtils.chunkIntersection(0, CHUNK_SIZE + 100, CHUNK_SIZE + 200);
      expect(intersection3).toBeNull();
    });
  });
});

describe("ChunkManager", () => {
  let manager: ChunkManager<string>;

  beforeEach(() => {
    manager = new ChunkManager(() => new Array(CHUNK_SIZE));
  });

  describe("basic operations", () => {
    test("should create and access chunks", () => {
      const chunk0 = manager.getChunk(0);
      expect(chunk0).toBeInstanceOf(Array);
      expect(chunk0.length).toBe(CHUNK_SIZE);

      const chunk1 = manager.getChunk(1);
      expect(chunk1).toBeInstanceOf(Array);
      expect(chunk1).not.toBe(chunk0);
      
      expect(manager.getChunkCount()).toBe(2);
    });

    test("should get same chunk on repeated access", () => {
      const chunk1 = manager.getChunk(0);
      const chunk2 = manager.getChunk(0);
      expect(chunk1).toBe(chunk2);
    });

    test("should set and get values", () => {
      manager.set(0, "first");
      manager.set(1000, "second");
      manager.set(CHUNK_SIZE, "third");
      manager.set(CHUNK_SIZE * 2 + 500, "fourth");

      expect(manager.get(0)).toBe("first");
      expect(manager.get(1000)).toBe("second");
      expect(manager.get(CHUNK_SIZE)).toBe("third");
      expect(manager.get(CHUNK_SIZE * 2 + 500)).toBe("fourth");
    });

    test("should return undefined for unset values", () => {
      expect(manager.get(0)).toBeUndefined();
      expect(manager.get(1000)).toBeUndefined();
      expect(manager.get(CHUNK_SIZE * 10)).toBeUndefined();
    });
  });

  describe("metadata management", () => {
    test("should create metadata for chunks", () => {
      const metadata0 = manager.getMetadata(0);
      expect(metadata0.id).toBe(0);
      expect(metadata0.isDirty).toBe(false);

      const metadata5 = manager.getMetadata(5);
      expect(metadata5.id).toBe(5);
      expect(metadata5.startIndex).toBe(CHUNK_SIZE * 5);
      expect(metadata5.endIndex).toBe(CHUNK_SIZE * 6);
    });

    test("should mark chunks as dirty when setting values", () => {
      manager.set(1000, "test");
      const metadata = manager.getMetadata(0);
      expect(metadata.isDirty).toBe(true);
    });

    test("should track dirty chunks", () => {
      manager.set(100, "a"); // chunk 0
      manager.set(CHUNK_SIZE + 100, "b"); // chunk 1
      manager.set(CHUNK_SIZE * 3 + 100, "c"); // chunk 3

      const dirtyChunks = manager.getDirtyChunks();
      expect(dirtyChunks).toContain(0);
      expect(dirtyChunks).toContain(1);
      expect(dirtyChunks).toContain(3);
      expect(dirtyChunks).not.toContain(2);
    });

    test("should mark chunks as clean", () => {
      manager.set(100, "test");
      expect(manager.getMetadata(0).isDirty).toBe(true);

      manager.markClean(0);
      expect(manager.getMetadata(0).isDirty).toBe(false);
    });

    test("should mark all chunks as clean", () => {
      manager.set(100, "a");
      manager.set(CHUNK_SIZE + 100, "b");
      
      expect(manager.getDirtyChunks().length).toBe(2);
      
      manager.markAllClean();
      expect(manager.getDirtyChunks().length).toBe(0);
    });

    test("should set commit IDs", () => {
      // Create chunk 0 first
      manager.set(100, "test");
      
      manager.setCommitId(0, 123n);
      expect(manager.getMetadata(0).commitId).toBe(123n);
    });
  });

  describe("range operations", () => {
    beforeEach(() => {
      // Set up test data across multiple chunks
      manager.set(500, "chunk0-a");
      manager.set(1000, "chunk0-b");
      manager.set(CHUNK_SIZE + 200, "chunk1-a");
      manager.set(CHUNK_SIZE * 2 + 300, "chunk2-a");
    });

    test("should iterate over chunks in range", () => {
      const visited: number[] = [];
      
      manager.forEachChunkInRange(0, CHUNK_SIZE * 2 + 500, (chunk, chunkId, metadata) => {
        visited.push(chunkId);
        expect(chunk).toBeInstanceOf(Array);
        expect(metadata.id).toBe(chunkId);
      });

      expect(visited).toEqual([0, 1, 2]);
    });
  });

  describe("utility operations", () => {
    beforeEach(() => {
      manager.set(100, "a");
      manager.set(CHUNK_SIZE + 100, "b");
      manager.set(CHUNK_SIZE * 5 + 100, "c");
    });

    test("should provide statistics", () => {
      const stats = manager.getStats();
      
      expect(stats.chunkCount).toBe(6); // chunks 0, 1, 5
      expect(stats.totalCapacity).toBe(CHUNK_SIZE * 6);
      expect(stats.dirtyChunks).toBe(3);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    });

    test("should compact by removing empty trailing chunks", () => {
      // Create chunks with gaps
      manager.set(CHUNK_SIZE * 10, "far");
      expect(manager.getChunkCount()).toBe(11);

      // Remove the far value to make trailing chunks empty
      const chunk10 = manager.getChunk(10);
      chunk10[0] = undefined;

      manager.compact();
      
      // Should have removed empty trailing chunks
      expect(manager.getChunkCount()).toBeLessThan(11);
    });

    test("should clear all chunks", () => {
      expect(manager.getChunkCount()).toBeGreaterThan(0);
      
      manager.clear();
      
      expect(manager.getChunkCount()).toBe(0);
      expect(manager.getDirtyChunks().length).toBe(0);
    });

    test("should clone manager", () => {
      const cloned = manager.clone();
      
      expect(cloned.getChunkCount()).toBe(manager.getChunkCount());
      expect(cloned.get(100)).toBe("a");
      expect(cloned.get(CHUNK_SIZE + 100)).toBe("b");
      
      // Should be independent
      cloned.set(200, "new");
      expect(manager.get(200)).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("should handle large chunk IDs", () => {
      const largeChunkId = 1000000;
      const chunk = manager.getChunk(largeChunkId);
      expect(chunk).toBeInstanceOf(Array);
      expect(manager.getMetadata(largeChunkId).id).toBe(largeChunkId);
    });

    test("should handle zero index", () => {
      manager.set(0, "zero");
      expect(manager.get(0)).toBe("zero");
      expect(manager.getMetadata(0).isDirty).toBe(true);
    });

    test("should handle chunk boundary values", () => {
      manager.set(CHUNK_SIZE - 1, "last-in-chunk-0");
      manager.set(CHUNK_SIZE, "first-in-chunk-1");
      
      expect(manager.get(CHUNK_SIZE - 1)).toBe("last-in-chunk-0");
      expect(manager.get(CHUNK_SIZE)).toBe("first-in-chunk-1");
      
      expect(ChunkUtils.chunkAt(CHUNK_SIZE - 1)).toBe(0);
      expect(ChunkUtils.chunkAt(CHUNK_SIZE)).toBe(1);
    });
  });
});