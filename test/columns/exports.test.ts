import { describe, test, expect } from "bun:test";
import { 
  // Column classes
  BaseColumn,
  NumericColumn,
  StringColumn,
  EnumColumn,
  BooleanColumn,
  RecordColumn,
  KeyColumn,
  IndexColumn,
  SortIndexColumn,
  
  // Readers
  ColumnReader,
  NumericColumnReader,
  StringColumnReader,
  EnumColumnReader,
  BooleanColumnReader,
  RecordColumnReader,
  KeyColumnReader,
  IndexColumnReader,
  SortIndexColumnReader,
  
  // Utilities
  KeyColumnUtils,
  SortIndexUtils,
  ColumnRegistry,
  IndexManager,
  
  // Factory functions
  createInt8Column,
  createInt16Column,
  createInt32Column,
  createInt64Column,
  createUint8Column,
  createUint16Column,
  createUint32Column,
  createUint64Column,
  createFloat32Column,
  createFloat64Column,
  createStringColumn,
  createEnumColumn,
  createBooleanColumn,
  createRecordColumn,
  createKeyColumn,
  createIndexColumn,
  createSortIndexColumn,
  
  // Main factory class
  ColumnFactory,
  
  // Types
  type ColumnSchema,
  type ColumnType,
  type NumericType,
  type NumericValue,
  type Reader,
  type Row,
  type Predicate,
  type StringAccessor,
  type NumericAccessor,
  type BooleanAccessor,
  type RecordAccessor,
  type TransactionState,
  type Marshaler,
  type Unmarshaler,
  type JSONMarshaler
} from "../../src/columns/index.js";

describe("Column Exports", () => {
  describe("column classes", () => {
    test("should export all column classes", () => {
      expect(typeof BaseColumn).toBe("function");
      expect(typeof NumericColumn).toBe("function");
      expect(typeof StringColumn).toBe("function");
      expect(typeof EnumColumn).toBe("function");
      expect(typeof BooleanColumn).toBe("function");
      expect(typeof RecordColumn).toBe("function");
      expect(typeof KeyColumn).toBe("function");
      expect(typeof IndexColumn).toBe("function");
      expect(typeof SortIndexColumn).toBe("function");
    });
  });

  describe("reader classes", () => {
    test("should export all reader classes", () => {
      expect(typeof ColumnReader).toBe("function");
      expect(typeof NumericColumnReader).toBe("function");
      expect(typeof StringColumnReader).toBe("function");
      expect(typeof EnumColumnReader).toBe("function");
      expect(typeof BooleanColumnReader).toBe("function");
      expect(typeof RecordColumnReader).toBe("function");
      expect(typeof KeyColumnReader).toBe("function");
      expect(typeof IndexColumnReader).toBe("function");
      expect(typeof SortIndexColumnReader).toBe("function");
    });
  });

  describe("utility classes", () => {
    test("should export utility classes", () => {
      expect(typeof KeyColumnUtils).toBe("function");
      expect(typeof SortIndexUtils).toBe("function");
      expect(typeof ColumnRegistry).toBe("function");
      expect(typeof IndexManager).toBe("function");
    });
  });

  describe("factory functions", () => {
    test("should export all factory functions", () => {
      // Numeric factories
      expect(typeof createInt8Column).toBe("function");
      expect(typeof createInt16Column).toBe("function");
      expect(typeof createInt32Column).toBe("function");
      expect(typeof createInt64Column).toBe("function");
      expect(typeof createUint8Column).toBe("function");
      expect(typeof createUint16Column).toBe("function");
      expect(typeof createUint32Column).toBe("function");
      expect(typeof createUint64Column).toBe("function");
      expect(typeof createFloat32Column).toBe("function");
      expect(typeof createFloat64Column).toBe("function");
      
      // Other column factories
      expect(typeof createStringColumn).toBe("function");
      expect(typeof createEnumColumn).toBe("function");
      expect(typeof createBooleanColumn).toBe("function");
      expect(typeof createRecordColumn).toBe("function");
      expect(typeof createKeyColumn).toBe("function");
      expect(typeof createIndexColumn).toBe("function");
      expect(typeof createSortIndexColumn).toBe("function");
    });

    test("should create correct column types", () => {
      const int32Col = createInt32Column("test");
      expect(int32Col).toBeInstanceOf(NumericColumn);
      expect(int32Col.getNumericType()).toBe("int32");

      const stringCol = createStringColumn("test");
      expect(stringCol).toBeInstanceOf(StringColumn);

      const boolCol = createBooleanColumn("test");
      expect(boolCol).toBeInstanceOf(BooleanColumn);

      const keyCol = createKeyColumn("test");
      expect(keyCol).toBeInstanceOf(KeyColumn);
    });
  });

  describe("main factory class", () => {
    test("should export ColumnFactory class", () => {
      expect(typeof ColumnFactory).toBe("function");
    });
  });
});

describe("ColumnFactory", () => {
  describe("numeric column factories", () => {
    test("should create all numeric column types", () => {
      const int8 = ColumnFactory.int8("test");
      expect(int8).toBeInstanceOf(NumericColumn);
      expect(int8.getNumericType()).toBe("int8");

      const int16 = ColumnFactory.int16("test");
      expect(int16.getNumericType()).toBe("int16");

      const int32 = ColumnFactory.int32("test");
      expect(int32.getNumericType()).toBe("int32");

      const int64 = ColumnFactory.int64("test");
      expect(int64.getNumericType()).toBe("int64");

      const uint8 = ColumnFactory.uint8("test");
      expect(uint8.getNumericType()).toBe("uint8");

      const uint16 = ColumnFactory.uint16("test");
      expect(uint16.getNumericType()).toBe("uint16");

      const uint32 = ColumnFactory.uint32("test");
      expect(uint32.getNumericType()).toBe("uint32");

      const uint64 = ColumnFactory.uint64("test");
      expect(uint64.getNumericType()).toBe("uint64");

      const float32 = ColumnFactory.float32("test");
      expect(float32.getNumericType()).toBe("float32");

      const float64 = ColumnFactory.float64("test");
      expect(float64.getNumericType()).toBe("float64");
    });

    test("should pass options to numeric columns", () => {
      const column = ColumnFactory.int32("test", { customOption: "value" });
      expect(column.getName()).toBe("test");
      expect(column.getType()).toBe("int32");
    });
  });

  describe("string column factories", () => {
    test("should create string column", () => {
      const column = ColumnFactory.string("test");
      expect(column).toBeInstanceOf(StringColumn);
      expect(column.getName()).toBe("test");
      expect(column.getType()).toBe("string");
    });

    test("should create enum column", () => {
      const column = ColumnFactory.enum("test");
      expect(column).toBeInstanceOf(EnumColumn);
      expect(column.getName()).toBe("test");
      expect(column.getType()).toBe("enum");
    });

    test("should pass options to string columns", () => {
      const stringCol = ColumnFactory.string("test", { option: "value" });
      const enumCol = ColumnFactory.enum("test", { option: "value" });
      
      expect(stringCol.getName()).toBe("test");
      expect(enumCol.getName()).toBe("test");
    });
  });

  describe("boolean column factory", () => {
    test("should create boolean column", () => {
      const column = ColumnFactory.boolean("test");
      expect(column).toBeInstanceOf(BooleanColumn);
      expect(column.getName()).toBe("test");
      expect(column.getType()).toBe("boolean");
    });

    test("should pass options to boolean column", () => {
      const column = ColumnFactory.boolean("test", { option: "value" });
      expect(column.getName()).toBe("test");
    });
  });

  describe("record column factory", () => {
    test("should create record column", () => {
      const column = ColumnFactory.record("test");
      expect(column).toBeInstanceOf(RecordColumn);
      expect(column.getName()).toBe("test");
      expect(column.getType()).toBe("record");
    });

    test("should create typed record column", () => {
      interface TestRecord {
        id: number;
        name: string;
      }

      const column = ColumnFactory.record<TestRecord>("test");
      expect(column).toBeInstanceOf(RecordColumn);
    });

    test("should pass marshaler options to record column", () => {
      const marshaler = (value: any) => new Uint8Array();
      const unmarshaler = (data: Uint8Array) => ({});

      const column = ColumnFactory.record("test", { marshaler, unmarshaler });
      expect(column.getName()).toBe("test");
    });
  });

  describe("key column factory", () => {
    test("should create key column", () => {
      const column = ColumnFactory.key("test");
      expect(column).toBeInstanceOf(KeyColumn);
      expect(column.getName()).toBe("test");
      expect(column.getType()).toBe("key");
    });

    test("should pass unique option to key column", () => {
      const uniqueCol = ColumnFactory.key("unique", { unique: true });
      const nonUniqueCol = ColumnFactory.key("non_unique", { unique: false });
      
      expect(uniqueCol.getName()).toBe("unique");
      expect(nonUniqueCol.getName()).toBe("non_unique");
    });
  });

  describe("index column factories", () => {
    test("should create bitmap index column", () => {
      const predicate = (reader: Reader) => true;
      const column = ColumnFactory.index("test_index", "target_column", predicate);
      
      expect(column).toBeInstanceOf(IndexColumn);
      expect(column.getName()).toBe("test_index");
      expect(column.getType()).toBe("index");
      expect(column.getTargetColumn()).toBe("target_column");
    });

    test("should create sort index column", () => {
      const keyExtractor = (reader: Reader) => reader.getString() || '';
      const column = ColumnFactory.sortIndex("test_sort", "target_column", keyExtractor);
      
      expect(column).toBeInstanceOf(SortIndexColumn);
      expect(column.getName()).toBe("test_sort");
      expect(column.getType()).toBe("sort-index");
      expect(column.getTargetColumnName()).toBe("target_column");
    });

    test("should pass options to index columns", () => {
      const predicate = (reader: Reader) => true;
      const keyExtractor = (reader: Reader) => reader.getString() || '';
      
      const indexCol = ColumnFactory.index("test_index", "target", predicate, { option: "value" });
      const sortCol = ColumnFactory.sortIndex("test_sort", "target", keyExtractor, { option: "value" });
      
      expect(indexCol.getName()).toBe("test_index");
      expect(sortCol.getName()).toBe("test_sort");
    });
  });

  describe("convenient sort index factories", () => {
    test("should create string sort index", () => {
      const column = ColumnFactory.stringSortIndex("string_sort", "target");
      
      expect(column).toBeInstanceOf(SortIndexColumn);
      expect(column.getName()).toBe("string_sort");
      expect(column.getTargetColumnName()).toBe("target");
    });

    test("should create numeric sort index", () => {
      const column = ColumnFactory.numericSortIndex("numeric_sort", "target");
      
      expect(column).toBeInstanceOf(SortIndexColumn);
      expect(column.getName()).toBe("numeric_sort");
      expect(column.getTargetColumnName()).toBe("target");
    });

    test("should create date sort index", () => {
      const column = ColumnFactory.dateSortIndex("date_sort", "target");
      
      expect(column).toBeInstanceOf(SortIndexColumn);
      expect(column.getName()).toBe("date_sort");
      expect(column.getTargetColumnName()).toBe("target");
    });
  });
});

describe("Column Integration", () => {
  test("should work together in a complete example", async () => {
    // Create a registry
    const registry = new ColumnRegistry();

    // Create various column types using factory
    const userIds = ColumnFactory.int32("user_ids");
    const userNames = ColumnFactory.string("user_names");
    const userEmails = ColumnFactory.enum("user_emails");
    const userActive = ColumnFactory.boolean("user_active");
    const userProfiles = ColumnFactory.record<{name: string, age: number}>("user_profiles");
    const primaryKeys = ColumnFactory.key("primary_keys");

    // Register columns
    await registry.register(userIds);
    await registry.register(userNames);
    await registry.register(userEmails);
    await registry.register(userActive);
    await registry.register(userProfiles);
    await registry.register(primaryKeys);

    // Add some data
    await userIds.set(0, 1001);
    await userNames.set(0, "Alice Smith");
    await userEmails.setString(0, "alice@example.com");
    await userActive.set(0, true);
    await userProfiles.set(0, { name: "Alice Smith", age: 30 });
    await primaryKeys.set(0, "user_1001");

    await userIds.set(1, 1002);
    await userNames.set(1, "Bob Johnson");
    await userEmails.setString(1, "bob@example.com");
    await userActive.set(1, false);
    await userProfiles.set(1, { name: "Bob Johnson", age: 25 });
    await primaryKeys.set(1, "user_1002");

    // Verify data
    expect(await userIds.get(0)).toBe(1001);
    expect(await userNames.get(0)).toBe("Alice Smith");
    expect(await userEmails.getString(0)).toBe("alice@example.com");
    expect(await userActive.get(0)).toBe(true);
    expect(await userProfiles.get(0)).toEqual({ name: "Alice Smith", age: 30 });
    expect(await primaryKeys.get(0)).toBe("user_1001");

    // Test registry
    expect(registry.has("user_ids")).toBe(true);
    expect(registry.getNames()).toHaveLength(6);
    
    const stats = registry.getStats();
    expect(stats.columnCount).toBe(6);
    expect(stats.totalSize).toBe(12); // 2 entries × 6 columns

    // Create sort indexes
    const nameIndex = ColumnFactory.stringSortIndex("name_sort", "user_names");
    const idIndex = ColumnFactory.numericSortIndex("id_sort", "user_ids");

    await nameIndex.rebuild(userNames);
    await idIndex.rebuild(userIds);

    // Test sorting
    const sortedByName = await nameIndex.getAllSorted();
    expect(sortedByName[0].key).toBe("Alice Smith");
    expect(sortedByName[1].key).toBe("Bob Johnson");

    const sortedByIds = await idIndex.getAllSorted();
    expect(parseInt(sortedByIds[0].key)).toBe(1001);
    expect(parseInt(sortedByIds[1].key)).toBe(1002);

    // Create bitmap index
    const activeIndex = ColumnFactory.index(
      "active_index",
      "user_active",
      (reader: Reader) => reader.getBoolean() === true
    );

    // Note: We can't easily test bitmap index without more setup,
    // but we can verify it was created correctly
    expect(activeIndex.getTargetColumn()).toBe("user_active");

    // Test key utilities
    const generatedKey = KeyColumnUtils.generateUniqueKey("user_");
    expect(generatedKey.startsWith("user_")).toBe(true);

    const uuidKey = KeyColumnUtils.generateUUIDKey();
    expect(uuidKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("should handle serialization across different column types", async () => {
    // Create columns
    const intCol = ColumnFactory.int32("integers");
    const strCol = ColumnFactory.string("strings");
    const boolCol = ColumnFactory.boolean("booleans");
    const keyCol = ColumnFactory.key("keys");

    // Add data
    await intCol.set(0, 42);
    await strCol.set(0, "test");
    await boolCol.set(0, true);
    await keyCol.set(0, "key_001");

    // Serialize all
    const intSerialized = await intCol.serialize();
    const strSerialized = await strCol.serialize();
    const boolSerialized = await boolCol.serialize();
    const keySerialized = await keyCol.serialize();

    // Create new columns and deserialize
    const newIntCol = ColumnFactory.int32("restored_integers");
    const newStrCol = ColumnFactory.string("restored_strings");
    const newBoolCol = ColumnFactory.boolean("restored_booleans");
    const newKeyCol = ColumnFactory.key("restored_keys");

    await newIntCol.deserialize(intSerialized);
    await newStrCol.deserialize(strSerialized);
    await newBoolCol.deserialize(boolSerialized);
    await newKeyCol.deserialize(keySerialized);

    // Verify restored data
    expect(await newIntCol.get(0)).toBe(42);
    expect(await newStrCol.get(0)).toBe("test");
    expect(await newBoolCol.get(0)).toBe(true);
    expect(await newKeyCol.get(0)).toBe("key_001");
  });

  test("should handle complex record types", async () => {
    interface User {
      id: number;
      profile: {
        name: string;
        email: string;
        preferences: {
          theme: string;
          notifications: boolean;
        };
      };
      tags: string[];
      created: Date;
    }

    const userCol = ColumnFactory.record<User>("users");

    const testUser: User = {
      id: 1,
      profile: {
        name: "Test User",
        email: "test@example.com",
        preferences: {
          theme: "dark",
          notifications: true
        }
      },
      tags: ["admin", "premium"],
      created: new Date("2023-01-01")
    };

    await userCol.set(0, testUser);
    const retrieved = await userCol.get(0);

    expect(retrieved?.id).toBe(1);
    expect(retrieved?.profile.name).toBe("Test User");
    expect(retrieved?.profile.preferences.theme).toBe("dark");
    expect(retrieved?.tags).toEqual(["admin", "premium"]);

    // Test record field sorting
    const nameIndex = SortIndexUtils.createRecordFieldIndex(
      "name_index",
      "users",
      "profile.name"
    );

    await nameIndex.rebuild(userCol);
    const sorted = await nameIndex.getAllSorted();
    expect(sorted[0].key).toBe("Test User");
  });
});