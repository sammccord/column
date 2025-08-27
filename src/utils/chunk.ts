import { CHUNK_SIZE } from '../constants.js';
import type { ChunkMetadata } from '../types.js';

/**
 * Utility functions for managing chunked data storage
 */
export class ChunkUtils {
  /**
   * Calculate which chunk contains the given index
   */
  static chunkAt(index: number): number {
    return Math.floor(index / CHUNK_SIZE);
  }

  /**
   * Calculate the local index within a chunk
   */
  static localIndex(index: number): number {
    return index % CHUNK_SIZE;
  }

  /**
   * Calculate the starting index of a chunk
   */
  static chunkStart(chunkId: number): number {
    return chunkId * CHUNK_SIZE;
  }

  /**
   * Calculate the ending index of a chunk (exclusive)
   */
  static chunkEnd(chunkId: number): number {
    return (chunkId + 1) * CHUNK_SIZE;
  }

  /**
   * Get the range of chunks that contain the given index range
   */
  static chunkRange(startIndex: number, endIndex: number): { start: number; end: number } {
    return {
      start: this.chunkAt(startIndex),
      end: this.chunkAt(endIndex - 1)
    };
  }

  /**
   * Create metadata for a new chunk
   */
  static createMetadata(chunkId: number): ChunkMetadata {
    return {
      id: chunkId,
      startIndex: this.chunkStart(chunkId),
      endIndex: this.chunkEnd(chunkId),
      isDirty: false,
      commitId: 0n
    };
  }

  /**
   * Check if an index is valid for the given chunk
   */
  static isValidIndex(chunkId: number, localIndex: number): boolean {
    return localIndex >= 0 && localIndex < CHUNK_SIZE;
  }

  /**
   * Get all chunk IDs that intersect with the given range
   */
  static getIntersectingChunks(startIndex: number, endIndex: number): number[] {
    const range = this.chunkRange(startIndex, endIndex);
    const chunks: number[] = [];
    
    for (let chunkId = range.start; chunkId <= range.end; chunkId++) {
      chunks.push(chunkId);
    }
    
    return chunks;
  }

  /**
   * Calculate the intersection of a chunk with an index range
   */
  static chunkIntersection(
    chunkId: number, 
    rangeStart: number, 
    rangeEnd: number
  ): { localStart: number; localEnd: number; globalStart: number; globalEnd: number } | null {
    const chunkStart = this.chunkStart(chunkId);
    const chunkEnd = this.chunkEnd(chunkId);

    // Check if there's any intersection
    if (rangeEnd <= chunkStart || rangeStart >= chunkEnd) {
      return null;
    }

    const globalStart = Math.max(rangeStart, chunkStart);
    const globalEnd = Math.min(rangeEnd, chunkEnd);

    return {
      localStart: globalStart - chunkStart,
      localEnd: globalEnd - chunkStart,
      globalStart,
      globalEnd
    };
  }
}

/**
 * Manages a collection of chunks with automatic growth
 */
export class ChunkManager<T> {
  private chunks: T[][] = [];
  private metadata: ChunkMetadata[] = [];
  private createChunk: () => T[];

  constructor(createChunk: () => T[]) {
    this.createChunk = createChunk;
  }

  /**
   * Get or create a chunk at the specified ID
   */
  getChunk(chunkId: number): T[] {
    // Ensure we have enough chunks
    while (this.chunks.length <= chunkId) {
      this.chunks.push(this.createChunk());
      this.metadata.push(ChunkUtils.createMetadata(this.chunks.length - 1));
    }

    return this.chunks[chunkId];
  }

  /**
   * Get chunk metadata
   */
  getMetadata(chunkId: number): ChunkMetadata {
    this.getChunk(chunkId); // Ensure chunk exists
    return this.metadata[chunkId];
  }

  /**
   * Set a value at the given global index
   */
  set(index: number, value: T): void {
    const chunkId = ChunkUtils.chunkAt(index);
    const localIndex = ChunkUtils.localIndex(index);
    
    const chunk = this.getChunk(chunkId);
    chunk[localIndex] = value;
    
    // Mark chunk as dirty
    this.metadata[chunkId].isDirty = true;
  }

  /**
   * Get a value at the given global index
   */
  get(index: number): T | undefined {
    const chunkId = ChunkUtils.chunkAt(index);
    const localIndex = ChunkUtils.localIndex(index);
    
    if (chunkId >= this.chunks.length) {
      return undefined;
    }

    return this.chunks[chunkId][localIndex];
  }

  /**
   * Get the total number of chunks
   */
  getChunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Get all dirty chunk IDs
   */
  getDirtyChunks(): number[] {
    const dirty: number[] = [];
    for (let i = 0; i < this.metadata.length; i++) {
      if (this.metadata[i].isDirty) {
        dirty.push(i);
      }
    }
    return dirty;
  }

  /**
   * Mark a chunk as clean (not dirty)
   */
  markClean(chunkId: number): void {
    if (chunkId < this.metadata.length) {
      this.metadata[chunkId].isDirty = false;
    }
  }

  /**
   * Mark all chunks as clean
   */
  markAllClean(): void {
    for (const meta of this.metadata) {
      meta.isDirty = false;
    }
  }

  /**
   * Set commit ID for a chunk
   */
  setCommitId(chunkId: number, commitId: bigint): void {
    if (chunkId < this.metadata.length) {
      this.metadata[chunkId].commitId = commitId;
    }
  }

  /**
   * Iterate over chunks in a range
   */
  forEachChunkInRange(
    startIndex: number,
    endIndex: number,
    callback: (chunk: T[], chunkId: number, metadata: ChunkMetadata) => void
  ): void {
    const chunkIds = ChunkUtils.getIntersectingChunks(startIndex, endIndex);
    
    for (const chunkId of chunkIds) {
      const chunk = this.getChunk(chunkId);
      const metadata = this.getMetadata(chunkId);
      callback(chunk, chunkId, metadata);
    }
  }

  /**
   * Compact chunks by removing unused space
   */
  compact(): void {
    // Remove trailing empty chunks
    while (this.chunks.length > 0) {
      const lastChunk = this.chunks[this.chunks.length - 1];
      const isEmpty = lastChunk.every(value => value === undefined || value === null);
      
      if (isEmpty) {
        this.chunks.pop();
        this.metadata.pop();
      } else {
        break;
      }
    }
  }

  /**
   * Get memory usage statistics
   */
  getStats(): {
    chunkCount: number;
    totalCapacity: number;
    estimatedMemoryBytes: number;
    dirtyChunks: number;
  } {
    const dirtyCount = this.getDirtyChunks().length;
    
    return {
      chunkCount: this.chunks.length,
      totalCapacity: this.chunks.length * CHUNK_SIZE,
      estimatedMemoryBytes: this.chunks.length * CHUNK_SIZE * 8, // Rough estimate
      dirtyChunks: dirtyCount
    };
  }

  /**
   * Clear all chunks
   */
  clear(): void {
    this.chunks.length = 0;
    this.metadata.length = 0;
  }

  /**
   * Clone the chunk manager
   */
  clone(): ChunkManager<T> {
    const cloned = new ChunkManager(this.createChunk);
    
    // Deep clone chunks
    for (let i = 0; i < this.chunks.length; i++) {
      cloned.chunks[i] = [...this.chunks[i]];
      cloned.metadata[i] = { ...this.metadata[i] };
    }
    
    return cloned;
  }
}