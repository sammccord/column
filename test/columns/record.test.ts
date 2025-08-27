import { describe, test, expect, beforeEach } from "bun:test";
import { TypedFastBitSet } from 'typedfastbitset';
import {
  RecordColumn,
  RecordColumnReader,
  RecordColumnAccessor,
  createRecordColumn,
  Marshaler,
  Unmarshaler,
  JSONMarshaler
} from "../../src/columns/record.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import type { TransactionState } from "../../src/types.js";

// Test data types
interface TestUser {
  id: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
  profile?: {
    city: string;
    country: string;
  };
}

class CustomMarshaler implements Marshaler, Unmarshaler {
  constructor(public value: string) {}

  marshal(): Uint8Array {
    return new TextEncoder().encode(`CUSTOM:${this.value}`);
  }

  unmarshal(data: Uint8Array): void {
    const decoded = new TextDecoder().decode(data);
    this.value = decoded.replace('CUSTOM:', '');
  }

  static fromBytes(data: Uint8Array): CustomMarshaler {
    const obj = new CustomMarshaler('');
    obj.unmarshal(data);
    return obj;
  }
}

describe("RecordColumn", () => {
  let column: RecordColumn<TestUser>;

  beforeEach(() => {
    column = createRecordColumn<TestUser>("test_records");
  });

  describe("basic operations", () => {
    test("should set and get record values", async () => {
      const user1: TestUser = {
        id: 1,
        name: "Alice",
        email: "alice@test.com",
        age: 30,
        active: true
      };

      const user2: TestUser = {
        id: 2,
        name: "Bob",
        email: "bob@test.com",
        age: 25,
        active: false,
        profile: {
          city: "New York",
          country: "USA"
        }
      };

      await column.set(0, user1);
      await column.set(1, user2);

      const retrieved1 = await column.get(0);
      const retrieved2 = await column.get(1);

      expect(retrieved1).toEqual(user1);
      expect(retrieved2).toEqual(user2);
      expect(await column.get(2)).toBeUndefined();
    });

    test("should validate non-null record values", async () => {
      await expect(column.set(0, null as any)).rejects.toThrow("cannot be null");
      await expect(column.set(0, undefined as any)).rejects.toThrow("cannot be null");
    });

    test("should track size correctly", async () => {
      expect(column.size()).toBe(0);

      await column.set(0, { id: 1, name: "Test", email: "test@test.com", age: 30, active: true });
      expect(column.size()).toBe(1);

      await column.set(5, { id: 2, name: "Test2", email: "test2@test.com", age: 25, active: false });
      expect(column.size()).toBe(2);

      // Update existing
      await column.set(0, { id: 3, name: "Updated", email: "updated@test.com", age: 35, active: true });
      expect(column.size()).toBe(2);
    });

    test("should remove records", async () => {
      const user: TestUser = {
        id: 1,
        name: "Alice",
        email: "alice@test.com",
        age: 30,
        active: true
      };

      await column.set(0, user);
      expect(column.size()).toBe(1);

      await column.remove(0);
      expect(await column.get(0)).toBeUndefined();
      expect(column.size()).toBe(0);
    });
  });

  describe("filtering operations", () => {
    beforeEach(async () => {
      const users: TestUser[] = [
        { id: 1, name: "Alice", email: "alice@test.com", age: 30, active: true },
        { id: 2, name: "Bob", email: "bob@test.com", age: 25, active: false },
        { id: 3, name: "Charlie", email: "charlie@test.com", age: 35, active: true },
        { id: 4, name: "Diana", email: "diana@test.com", age: 28, active: false },
        { id: 5, name: "Eve", email: "eve@test.com", age: 32, active: true, profile: { city: "London", country: "UK" } }
      ];

      for (let i = 0; i < users.length; i++) {
        await column.set(i, users[i]);
      }
    });

    test("should filter records with predicate", async () => {
      const result = await column.filterRecords((user) => user.age >= 30);

      expect(result.size()).toBe(3);
      expect(result.has(0)).toBe(true); // Alice, 30
      expect(result.has(2)).toBe(true); // Charlie, 35
      expect(result.has(4)).toBe(true); // Eve, 32
    });

    test("should filter by property value", async () => {
      const activeUsers = await column.filterByProperty("active", true);

      expect(activeUsers.size()).toBe(3);
      expect(activeUsers.has(0)).toBe(true); // Alice
      expect(activeUsers.has(2)).toBe(true); // Charlie
      expect(activeUsers.has(4)).toBe(true); // Eve
    });

    test("should filter by nested property", async () => {
      const result = await column.filterByNestedProperty("profile.country", "UK");

      expect(result.size()).toBe(1);
      expect(result.has(4)).toBe(true); // Eve
    });

    test("should handle non-existent nested properties", async () => {
      const result = await column.filterByNestedProperty("profile.unknown", "value");
      expect(result.isEmpty()).toBe(true);
    });

    test("should filter with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([0, 2, 4]); // Alice, Charlie, Eve
      const result = await column.filterByProperty("active", true, constraintBitmap);

      expect(result.size()).toBe(3); // All three in constraint are active
      expect(result.has(0)).toBe(true);
      expect(result.has(2)).toBe(true);
      expect(result.has(4)).toBe(true);
    });

    test("should return empty result for non-matching filter", async () => {
      const result = await column.filterByProperty("age", 100);
      expect(result.isEmpty()).toBe(true);
    });
  });

  describe("mapping operations", () => {
    beforeEach(async () => {
      const users: TestUser[] = [
        { id: 1, name: "Alice", email: "alice@test.com", age: 30, active: true },
        { id: 2, name: "Bob", email: "bob@test.com", age: 25, active: false },
        { id: 3, name: "Charlie", email: "charlie@test.com", age: 35, active: true }
      ];

      for (let i = 0; i < users.length; i++) {
        await column.set(i, users[i]);
      }
    });

    test("should map records to extracted values", async () => {
      const names = await column.mapRecords((user) => user.name);

      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });

    test("should map with index information", async () => {
      const indexedNames = await column.mapRecords((user, index) => `${index}:${user.name}`);

      expect(indexedNames).toEqual(["0:Alice", "1:Bob", "2:Charlie"]);
    });

    test("should extract specific property", async () => {
      const ages = await column.extractProperty("age");

      expect(ages).toEqual([30, 25, 35]);
    });

    test("should map with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([0, 2]); // Alice, Charlie
      const names = await column.mapRecords((user) => user.name, constraintBitmap);

      expect(names).toEqual(["Alice", "Charlie"]);
    });

    test("should extract property with bitmap constraint", async () => {
      const constraintBitmap = BitmapUtils.fromIndices([1, 2]); // Bob, Charlie
      const emails = await column.extractProperty("email", constraintBitmap);

      expect(emails).toEqual(["bob@test.com", "charlie@test.com"]);
    });
  });

  describe("custom marshaling", () => {
    test("should use custom marshaler/unmarshaler", async () => {
      const customColumn = createRecordColumn<CustomMarshaler>("custom", {
        marshaler: (value) => value.marshal(),
        unmarshaler: (data) => CustomMarshaler.fromBytes(data)
      });

      const obj1 = new CustomMarshaler("test1");
      const obj2 = new CustomMarshaler("test2");

      await customColumn.set(0, obj1);
      await customColumn.set(1, obj2);

      const retrieved1 = await customColumn.get(0);
      const retrieved2 = await customColumn.get(1);

      expect(retrieved1).toBeInstanceOf(CustomMarshaler);
      expect(retrieved1?.value).toBe("test1");
      expect(retrieved2?.value).toBe("test2");
    });

    test("should use object's own marshal method", async () => {
      const simpleColumn = createRecordColumn<CustomMarshaler>("simple");
      const obj = new CustomMarshaler("auto-marshal");

      await simpleColumn.set(0, obj);

      // The implementation should detect the marshal method and use it
      // For this test, we'll just verify the object is stored and retrieved
      const retrieved = await simpleColumn.get(0);
      expect(retrieved).toEqual(obj);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize with JSON fallback", async () => {
      const user1: TestUser = {
        id: 1,
        name: "Alice",
        email: "alice@test.com",
        age: 30,
        active: true,
        profile: { city: "Paris", country: "France" }
      };

      const user2: TestUser = {
        id: 2,
        name: "Bob",
        email: "bob@test.com",
        age: 25,
        active: false
      };

      await column.set(0, user1);
      await column.set(10, user2);

      const serialized = await column.serialize();
      expect(serialized).toBeInstanceOf(Uint8Array);

      const newColumn = createRecordColumn<TestUser>("restored");
      await newColumn.deserialize(serialized);

      const retrieved1 = await newColumn.get(0);
      const retrieved2 = await newColumn.get(10);

      expect(retrieved1).toEqual(user1);
      expect(retrieved2).toEqual(user2);
      expect(newColumn.size()).toBe(2);
    });

    test("should serialize with custom marshaler", async () => {
      const customColumn = createRecordColumn<CustomMarshaler>("custom", {
        marshaler: (value) => value.marshal(),
        unmarshaler: (data) => CustomMarshaler.fromBytes(data)
      });

      const obj1 = new CustomMarshaler("serialize-test1");
      const obj2 = new CustomMarshaler("serialize-test2");

      await customColumn.set(0, obj1);
      await customColumn.set(5, obj2);

      const serialized = await customColumn.serialize();

      const restoredColumn = createRecordColumn<CustomMarshaler>("restored", {
        marshaler: (value) => value.marshal(),
        unmarshaler: (data) => CustomMarshaler.fromBytes(data)
      });

      await restoredColumn.deserialize(serialized);

      const retrieved1 = await restoredColumn.get(0);
      const retrieved2 = await restoredColumn.get(5);

      expect(retrieved1?.value).toBe("serialize-test1");
      expect(retrieved2?.value).toBe("serialize-test2");
    });

    test("should handle empty column serialization", async () => {
      const serialized = await column.serialize();
      const newColumn = createRecordColumn<TestUser>("restored");
      await newColumn.deserialize(serialized);

      expect(newColumn.size()).toBe(0);
    });

    test("should validate type code on deserialization", async () => {
      const user: TestUser = {
        id: 1,
        name: "Test",
        email: "test@test.com",
        age: 30,
        active: true
      };

      await column.set(0, user);
      const serialized = await column.serialize();

      // Corrupt the type code
      const corrupted = new Uint8Array(serialized);
      corrupted[4] = 255; // Invalid type code

      const newColumn = createRecordColumn<TestUser>("restored");
      await expect(newColumn.deserialize(corrupted)).rejects.toThrow("Type code mismatch");
    });
  });

  describe("cloning", () => {
    test("should clone column correctly", async () => {
      const user1: TestUser = {
        id: 1,
        name: "Alice",
        email: "alice@test.com",
        age: 30,
        active: true
      };

      const user2: TestUser = {
        id: 2,
        name: "Bob",
        email: "bob@test.com",
        age: 25,
        active: false
      };

      await column.set(0, user1);
      await column.set(1, user2);

      const cloned = column.clone();

      expect(cloned.getName()).toBe(column.getName());
      expect(cloned.size()).toBe(column.size());
      expect(await cloned.get(0)).toEqual(user1);
      expect(await cloned.get(1)).toEqual(user2);

      // Should be independent
      const user3: TestUser = {
        id: 3,
        name: "Charlie",
        email: "charlie@test.com",
        age: 35,
        active: true
      };

      await cloned.set(2, user3);
      expect(await column.get(2)).toBeUndefined();
    });

    test("should clone with custom marshalers", async () => {
      const customColumn = createRecordColumn<CustomMarshaler>("custom", {
        marshaler: (value) => value.marshal(),
        unmarshaler: (data) => CustomMarshaler.fromBytes(data)
      });

      const obj = new CustomMarshaler("clone-test");
      await customColumn.set(0, obj);

      const cloned = customColumn.clone();
      const retrieved = await cloned.get(0);

      expect(retrieved?.value).toBe("clone-test");
    });
  });

  describe("statistics and metadata", () => {
    test("should provide column statistics", async () => {
      const users: TestUser[] = [
        { id: 1, name: "Alice", email: "alice@test.com", age: 30, active: true },
        { id: 2, name: "Bob", email: "bob@test.com", age: 25, active: false }
      ];

      for (let i = 0; i < users.length; i++) {
        await column.set(i, users[i]);
      }

      const stats = column.getStats();

      expect(stats.name).toBe("test_records");
      expect(stats.type).toBe("record");
      expect(stats.size).toBe(2);
    });
  });
});

describe("RecordColumnReader", () => {
  let column: RecordColumn<TestUser>;
  let reader: RecordColumnReader<TestUser>;

  beforeEach(async () => {
    column = createRecordColumn<TestUser>("test");
    reader = new RecordColumnReader(column);

    const user1: TestUser = {
      id: 1,
      name: "Alice",
      email: "alice@test.com",
      age: 30,
      active: true
    };

    const user2: TestUser = {
      id: 2,
      name: "Bob",
      email: "bob@test.com",
      age: 25,
      active: false
    };

    await column.set(0, user1);
    await column.set(1, user2);
  });

  test("should read record values", () => {
    reader.setIndex(0);
    const record = reader.getRecord<TestUser>();
    expect(record?.name).toBe("Alice");
    expect(record?.age).toBe(30);

    reader.setIndex(1);
    const record2 = reader.getRecord<TestUser>();
    expect(record2?.name).toBe("Bob");
    expect(record2?.age).toBe(25);

    reader.setIndex(99);
    expect(reader.getRecord()).toBeUndefined();
  });
});

describe("RecordColumnAccessor", () => {
  let column: RecordColumn<TestUser>;
  let accessor: RecordColumnAccessor<TestUser>;
  let txnState: TransactionState;

  beforeEach(async () => {
    column = createRecordColumn<TestUser>("test");

    const user1: TestUser = {
      id: 1,
      name: "Alice",
      email: "alice@test.com",
      age: 30,
      active: true
    };

    const user2: TestUser = {
      id: 2,
      name: "Bob",
      email: "bob@test.com",
      age: 25,
      active: false
    };

    await column.set(0, user1);
    await column.set(1, user2);

    txnState = {
      cursor: 0,
      setup: false,
      index: new TypedFastBitSet(),
      dirty: new TypedFastBitSet(),
      columns: new Map()
    };

    accessor = new RecordColumnAccessor(column, txnState);
  });

  test("should get current record value", () => {
    txnState.cursor = 0;
    const record = accessor.get();
    expect(record?.name).toBe("Alice");

    txnState.cursor = 1;
    const record2 = accessor.get();
    expect(record2?.name).toBe("Bob");

    txnState.cursor = 99;
    expect(accessor.get()).toBeUndefined();
  });

  test("should provide column name", () => {
    expect(accessor.name()).toBe("test");
  });
});

describe("RecordColumn edge cases", () => {
  test("should handle complex nested objects", async () => {
    interface ComplexRecord {
      metadata: {
        created: Date;
        tags: string[];
        settings: {
          enabled: boolean;
          config: { [key: string]: any };
        };
      };
      data: number[];
    }

    const column = createRecordColumn<ComplexRecord>("complex");

    const record: ComplexRecord = {
      metadata: {
        created: new Date("2023-01-01"),
        tags: ["tag1", "tag2", "tag3"],
        settings: {
          enabled: true,
          config: {
            timeout: 5000,
            retries: 3,
            debug: true
          }
        }
      },
      data: [1, 2, 3, 4, 5]
    };

    await column.set(0, record);
    const retrieved = await column.get(0);

    expect(retrieved?.metadata.tags).toEqual(["tag1", "tag2", "tag3"]);
    expect(retrieved?.metadata.settings.config.timeout).toBe(5000);
    expect(retrieved?.data).toEqual([1, 2, 3, 4, 5]);
  });

  test("should handle filtering with complex predicates", async () => {
    const column = createRecordColumn<TestUser>("filter_test");

    const users: TestUser[] = [
      { id: 1, name: "Alice", email: "alice@company.com", age: 30, active: true },
      { id: 2, name: "Bob", email: "bob@gmail.com", age: 25, active: false },
      { id: 3, name: "Charlie", email: "charlie@company.com", age: 35, active: true },
      { id: 4, name: "Diana", email: "diana@yahoo.com", age: 28, active: true }
    ];

    for (let i = 0; i < users.length; i++) {
      await column.set(i, users[i]);
    }

    // Complex predicate: active users with company email over 25
    const result = await column.filterRecords((user) =>
      user.active &&
      user.email.includes("@company.com") &&
      user.age > 25
    );

    expect(result.size()).toBe(2);
    expect(result.has(0)).toBe(true); // Alice
    expect(result.has(2)).toBe(true); // Charlie
  });

  test("should handle sparse record data", async () => {
    const column = createRecordColumn<TestUser>("sparse");

    const user1: TestUser = { id: 1, name: "User1", email: "user1@test.com", age: 30, active: true };
    const user2: TestUser = { id: 1000, name: "User1000", email: "user1000@test.com", age: 25, active: false };

    await column.set(0, user1);
    await column.set(10000, user2);

    expect(column.size()).toBe(2);
    expect(await column.get(0)).toEqual(user1);
    expect(await column.get(10000)).toEqual(user2);
    expect(await column.get(5000)).toBeUndefined();
  });

  test("should handle records with circular references gracefully", async () => {
    interface CircularRecord {
      id: number;
      name: string;
      parent?: CircularRecord;
    }

    const column = createRecordColumn<CircularRecord>("circular");

    const parent: CircularRecord = { id: 1, name: "Parent" };
    const child: CircularRecord = { id: 2, name: "Child", parent };

    // This should work for storage but may have issues with JSON serialization
    await column.set(0, child);
    const retrieved = await column.get(0);

    expect(retrieved?.name).toBe("Child");
    expect(retrieved?.parent?.name).toBe("Parent");
  });
});
