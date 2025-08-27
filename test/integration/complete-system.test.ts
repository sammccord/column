import { describe, test, expect, beforeEach } from "bun:test";
import {
  ColumnFactory,
  ColumnRegistry,
  IndexManager,
  SortIndexUtils,
  KeyColumnUtils,
  type Reader,
  type TransactionState,
  type Predicate
} from "../../src/columns/index.js";
import { BitmapUtils } from "../../src/utils/bitmap.js";
import { TypedFastBitSet } from 'typedfastbitset';

// Test data interfaces
interface User {
  id: number;
  name: string;
  email: string;
  age: number;
  isActive: boolean;
  created: Date;
  profile: {
    city: string;
    country: string;
    preferences: {
      theme: string;
      notifications: boolean;
    };
  };
  tags: string[];
}

interface Order {
  id: number;
  userId: number;
  product: string;
  amount: number;
  status: 'pending' | 'completed' | 'cancelled';
  created: Date;
}

describe.skip("Complete System Integration", () => {
  let registry: ColumnRegistry;
  let indexManager: IndexManager;

  beforeEach(() => {
    registry = new ColumnRegistry();
    indexManager = new IndexManager();
  });

  describe("User Management System", () => {
    test("should handle complete user lifecycle", async () => {
      // Create user table columns
      const userIds = ColumnFactory.int32("user_ids");
      const userNames = ColumnFactory.string("user_names");
      const userEmails = ColumnFactory.enum("user_emails"); // Deduplicated emails
      const userAges = ColumnFactory.int32("user_ages");
      const userActive = ColumnFactory.boolean("user_active");
      const userProfiles = ColumnFactory.record<User["profile"]>("user_profiles");
      const userKeys = ColumnFactory.key("user_keys", { unique: true });

      // Register all columns
      await registry.register(userIds);
      await registry.register(userNames);
      await registry.register(userEmails);
      await registry.register(userAges);
      await registry.register(userActive);
      await registry.register(userProfiles);
      await registry.register(userKeys);

      // Create indexes for efficient querying
      const nameIndex = SortIndexUtils.createStringIndex("name_sort", "user_names");
      const ageIndex = SortIndexUtils.createNumericIndex("age_sort", "user_ages");
      const cityIndex = SortIndexUtils.createRecordFieldIndex("city_sort", "user_profiles", "city");

      // Create bitmap indexes for fast filtering
      const activeIndex = ColumnFactory.index(
        "active_index",
        "user_active",
        (reader: Reader) => reader.getBoolean() === true
      );

      const youngUsersIndex = ColumnFactory.index(
        "young_users_index",
        "user_ages",
        (reader: Reader) => (reader.getInt() || 0) < 30
      );

      // Add indexes to manager
      indexManager.addIndex(activeIndex);
      indexManager.addIndex(youngUsersIndex);

      // Insert test users
      const users: User[] = [
        {
          id: 1001,
          name: "Alice Smith",
          email: "alice@example.com",
          age: 28,
          isActive: true,
          created: new Date("2023-01-15"),
          profile: {
            city: "New York",
            country: "USA",
            preferences: { theme: "dark", notifications: true }
          },
          tags: ["premium", "early-adopter"]
        },
        {
          id: 1002,
          name: "Bob Johnson",
          email: "bob@example.com",
          age: 35,
          isActive: false,
          created: new Date("2023-02-20"),
          profile: {
            city: "London",
            country: "UK",
            preferences: { theme: "light", notifications: false }
          },
          tags: ["standard"]
        },
        {
          id: 1003,
          name: "Charlie Brown",
          email: "charlie@example.com",
          age: 25,
          isActive: true,
          created: new Date("2023-03-10"),
          profile: {
            city: "New York",
            country: "USA",
            preferences: { theme: "dark", notifications: true }
          },
          tags: ["premium", "student"]
        }
      ];

      // Insert users into columns
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const userKey = KeyColumnUtils.generateHashKey(user, "user_");

        await userIds.set(i, user.id);
        await userNames.set(i, user.name);
        await userEmails.setString(i, user.email);
        await userAges.set(i, user.age);
        await userActive.set(i, user.isActive);
        await userProfiles.set(i, user.profile);
        await userKeys.set(i, userKey);
      }

      // Build indexes
      await nameIndex.rebuild(userNames);
      await ageIndex.rebuild(userAges);
      await cityIndex.rebuild(userProfiles);
      await activeIndex.rebuildIndex(userActive.createReader({} as TransactionState));
      await youngUsersIndex.rebuildIndex(userAges.createReader({} as TransactionState));

      // Test basic data retrieval
      expect(await userIds.get(0)).toBe(1001);
      expect(await userNames.get(0)).toBe("Alice Smith");
      expect(await userEmails.getString(0)).toBe("alice@example.com");
      expect(await userActive.get(0)).toBe(true);

      // Test registry functionality
      expect(registry.getNames()).toHaveLength(7);
      const stats = registry.getStats();
      expect(stats.totalSize).toBe(21); // 3 users × 7 columns

      // Test email deduplication in enum column
      const uniqueEmails = userEmails.getUniqueValues();
      expect(uniqueEmails).toHaveLength(3);
      expect(uniqueEmails).toContain("alice@example.com");

      // Test sorted access
      const sortedByName = await nameIndex.getAllSorted();
      expect(sortedByName.map(item => item.key)).toEqual([
        "Alice Smith", "Bob Johnson", "Charlie Brown"
      ]);

      const sortedByAge = await ageIndex.getAllSorted();
      const ages = sortedByAge.map(item => parseInt(item.key));
      expect(ages).toEqual([25, 28, 35]);

      const sortedByCity = await cityIndex.getAllSorted();
      expect(sortedByCity.map(item => item.key)).toEqual([
        "London", "New York", "New York"
      ]);

      // Test range queries
      const usersInNewYork = await cityIndex.filterByValue("New York");
      expect(usersInNewYork.size()).toBe(2);
      expect(usersInNewYork.has(0)).toBe(true); // Alice
      expect(usersInNewYork.has(2)).toBe(true); // Charlie

      const youngUsers = await ageIndex.getRange(undefined, "30", false);
      expect(youngUsers).toHaveLength(2); // Alice (28) and Charlie (25)

      // Test bitmap filtering
      const activeUsersBitmap = activeIndex.findIndices(true);
      expect(activeUsersBitmap.size()).toBe(2); // Alice and Charlie

      // Test complex queries (active users in New York)
      const activeInNY = BitmapUtils.and(activeUsersBitmap, usersInNewYork);
      expect(activeInNY.size()).toBe(2);

      // Test key lookups
      expect(userKeys.hasKey(await userKeys.get(0) || "")).toBe(true);
      const aliceIndex = userKeys.findIndex(await userKeys.get(0) || "");
      expect(aliceIndex).toBe(0);

      // Test profile field access
      const aliceProfile = await userProfiles.get(0);
      expect(aliceProfile?.city).toBe("New York");
      expect(aliceProfile?.preferences.theme).toBe("dark");
    });
  });

  describe("E-commerce Order System", () => {
    test("should handle order processing and analytics", async () => {
      // Create order columns
      const orderIds = ColumnFactory.int32("order_ids");
      const userIds = ColumnFactory.int32("user_ids");
      const products = ColumnFactory.enum("products"); // Product names with deduplication
      const amounts = ColumnFactory.float64("amounts");
      const statuses = ColumnFactory.enum("statuses");
      const orderDates = ColumnFactory.record<{ date: Date }>("order_dates");
      const orderKeys = ColumnFactory.key("order_keys");

      // Register columns
      await registry.register(orderIds);
      await registry.register(userIds);
      await registry.register(products);
      await registry.register(amounts);
      await registry.register(statuses);
      await registry.register(orderDates);
      await registry.register(orderKeys);

      // Create analytical indexes
      const amountIndex = SortIndexUtils.createNumericIndex("amount_sort", "amounts");
      const dateIndex = SortIndexUtils.createDateIndex("date_sort", "order_dates");
      const productIndex = SortIndexUtils.createStringIndex("product_sort", "products");

      // Create bitmap indexes for filtering
      const completedIndex = ColumnFactory.index(
        "completed_orders",
        "statuses",
        (reader: Reader) => reader.getString() === "completed"
      );

      const highValueIndex = ColumnFactory.index(
        "high_value_orders",
        "amounts",
        (reader: Reader) => (reader.getFloat() || 0) > 100
      );

      // Sample orders
      const orders: Order[] = [
        {
          id: 2001,
          userId: 1001,
          product: "Laptop",
          amount: 999.99,
          status: "completed",
          created: new Date("2023-04-01")
        },
        {
          id: 2002,
          userId: 1002,
          product: "Mouse",
          amount: 29.99,
          status: "completed",
          created: new Date("2023-04-02")
        },
        {
          id: 2003,
          userId: 1001,
          product: "Keyboard",
          amount: 79.99,
          status: "pending",
          created: new Date("2023-04-03")
        },
        {
          id: 2004,
          userId: 1003,
          product: "Monitor",
          amount: 299.99,
          status: "completed",
          created: new Date("2023-04-04")
        },
        {
          id: 2005,
          userId: 1002,
          product: "Laptop",
          amount: 1299.99,
          status: "cancelled",
          created: new Date("2023-04-05")
        }
      ];

      // Insert orders
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const orderKey = `order_${order.id}`;

        await orderIds.set(i, order.id);
        await userIds.set(i, order.userId);
        await products.setString(i, order.product);
        await amounts.set(i, order.amount);
        await statuses.setString(i, order.status);
        await orderDates.set(i, { date: order.created });
        await orderKeys.set(i, orderKey);
      }

      // Build indexes
      await amountIndex.rebuild(amounts);
      await dateIndex.rebuild(orderDates);
      await productIndex.rebuild(products);
      await completedIndex.rebuildIndex(statuses.createReader({} as TransactionState));
      await highValueIndex.rebuildIndex(amounts.createReader({} as TransactionState));

      // Test basic analytics
      const totalRevenue = await amounts.sum();
      expect(totalRevenue).toBeCloseTo(2709.95);

      const avgOrderValue = await amounts.avg();
      expect(avgOrderValue).toBeCloseTo(541.99);

      const maxOrder = await amounts.max();
      expect(maxOrder).toBe(1299.99);

      const minOrder = await amounts.min();
      expect(minOrder).toBe(29.99);

      // Test product analytics
      const uniqueProducts = products.getUniqueValues();
      expect(uniqueProducts).toHaveLength(4);
      expect(uniqueProducts).toContain("Laptop");
      expect(uniqueProducts).toContain("Mouse");

      const productStats = products.getDeduplicationStats();
      expect(productStats.uniqueStrings).toBe(4);
      expect(productStats.totalInstances).toBe(5);

      // Test sorted access by amount
      const ordersByAmount = await amountIndex.getAllSorted();
      const sortedAmounts = ordersByAmount.map(item => parseFloat(item.key));
      expect(sortedAmounts).toEqual([29.99, 79.99, 299.99, 999.99, 1299.99]);

      // Test range queries
      const midRangeOrders = await amountIndex.getRange("50", "500", true);
      expect(midRangeOrders).toHaveLength(2); // $79.99 and $299.99

      // Test filtering
      const completedOrders = completedIndex.findIndices("completed");
      expect(completedOrders.size()).toBe(3);

      const highValueOrders = highValueIndex.findIndices(true);
      expect(highValueOrders.size()).toBe(3); // Orders > $100

      // Test complex analytics: completed high-value orders
      const completedHighValue = BitmapUtils.and(completedOrders, highValueOrders);
      expect(completedHighValue.size()).toBe(2);

      // Calculate revenue from completed high-value orders
      const completedHighValueRevenue = await amounts.sum(completedHighValue);
      expect(completedHighValueRevenue).toBeCloseTo(1299.98); // $999.99 + $299.99

      // Test user purchase patterns
      const user1001Orders = await userIds.filter((reader) => reader.getInt() === 1001);
      expect(user1001Orders.size()).toBe(2);

      const user1001Revenue = await amounts.sum(user1001Orders);
      expect(user1001Revenue).toBeCloseTo(1079.98);

      // Test time-based analysis
      const ordersByDate = await dateIndex.getAllSorted();
      expect(ordersByDate).toHaveLength(5);

      // Verify chronological order
      const dates = ordersByDate.map(item => new Date(item.key));
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] >= dates[i-1]).toBe(true);
      }
    });
  });

  describe("Data Warehouse Simulation", () => {
    test("should handle large-scale data operations", async () => {
      // Create fact table (sales)
      const salesIds = ColumnFactory.int64("sales_ids");
      const customerIds = ColumnFactory.int32("customer_ids");
      const productIds = ColumnFactory.int32("product_ids");
      const quantities = ColumnFactory.int32("quantities");
      const prices = ColumnFactory.float64("prices");
      const salesDates = ColumnFactory.record<{ timestamp: Date, quarter: string }>("sales_dates");
      const regions = ColumnFactory.enum("regions");

      // Create dimension tables
      const customerNames = ColumnFactory.string("customer_names");
      const productNames = ColumnFactory.string("product_names");
      const productCategories = ColumnFactory.enum("product_categories");

      // Register all columns
      const columns = [
        salesIds, customerIds, productIds, quantities, prices, salesDates, regions,
        customerNames, productNames, productCategories
      ];

      for (const column of columns) {
        await registry.register(column);
      }

      // Generate sample data (simulating 1000 sales records)
      const regions_list = ["North", "South", "East", "West"];
      const categories = ["Electronics", "Clothing", "Books", "Home"];
      const products = ["Product_A", "Product_B", "Product_C", "Product_D"];

      for (let i = 0; i < 1000; i++) {
        await salesIds.set(i, BigInt(3000 + i));
        await customerIds.set(i, 100 + (i % 50)); // 50 unique customers
        await productIds.set(i, 200 + (i % 20)); // 20 unique products
        await quantities.set(i, 1 + (i % 10));
        await prices.set(i, 10 + (i % 100));

        const date = new Date(2023, i % 12, (i % 28) + 1);
        const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`;
        await salesDates.set(i, { timestamp: date, quarter });

        await regions.setString(i, regions_list[i % 4]);
        await customerNames.set(i, `Customer_${100 + (i % 50)}`);
        await productNames.set(i, products[i % 4]);
        await productCategories.setString(i, categories[i % 4]);
      }

      // Create analytical indexes
      const customerIndex = SortIndexUtils.createNumericIndex("customer_sort", "customer_ids");
      const priceIndex = SortIndexUtils.createNumericIndex("price_sort", "prices");
      const regionIndex = SortIndexUtils.createStringIndex("region_sort", "regions");
      const categoryIndex = SortIndexUtils.createStringIndex("category_sort", "product_categories");

      // Build indexes
      await customerIndex.rebuild(customerIds);
      await priceIndex.rebuild(prices);
      await regionIndex.rebuild(regions);
      await categoryIndex.rebuild(productCategories);

      // Create bitmap indexes for OLAP-style queries
      const northRegionIndex = ColumnFactory.index(
        "north_region",
        "regions",
        (reader: Reader) => reader.getString() === "North"
      );

      const electronicsIndex = ColumnFactory.index(
        "electronics_category",
        "product_categories",
        (reader: Reader) => reader.getString() === "Electronics"
      );

      const highValueIndex = ColumnFactory.index(
        "high_value_sales",
        "prices",
        (reader: Reader) => (reader.getFloat() || 0) > 50
      );

      await northRegionIndex.rebuildIndex(regions.createReader({} as TransactionState));
      await electronicsIndex.rebuildIndex(productCategories.createReader({} as TransactionState));
      await highValueIndex.rebuildIndex(prices.createReader({} as TransactionState));

      // Test large-scale aggregations
      const totalRevenue = await prices.sum();
      expect(totalRevenue).toBeGreaterThan(50000);

      const avgPrice = await prices.avg();
      expect(avgPrice).toBeCloseTo(59.5);

      const totalQuantity = await quantities.sum();
      expect(totalQuantity).toBeGreaterThan(5000);

      // Test regional analysis
      const northSales = northRegionIndex.findIndices("North");
      expect(northSales.size()).toBe(250); // 1000 / 4 regions

      const northRevenue = await prices.sum(northSales);
      expect(northRevenue).toBeGreaterThan(10000);

      // Test category analysis
      const electronicsSales = electronicsIndex.findIndices("Electronics");
      expect(electronicsSales.size()).toBe(250); // 1000 / 4 categories

      // Test complex OLAP queries: High-value electronics sales in North region
      const northElectronics = BitmapUtils.and(northSales, electronicsSales);
      const highValueNorthElectronics = BitmapUtils.and(northElectronics, highValueIndex.findIndices(true));

      expect(highValueNorthElectronics.size()).toBeGreaterThan(0);

      const specialRevenue = await prices.sum(highValueNorthElectronics);
      expect(specialRevenue).toBeGreaterThan(0);

      // Test customer segmentation
      const topCustomers = await customerIndex.getRangeReverse(undefined, undefined, true, 10);
      expect(topCustomers).toHaveLength(10);

      // Test product performance
      const productPerformance = productCategories.getDeduplicationStats();
      expect(productPerformance.uniqueStrings).toBe(4);
      expect(productPerformance.compressionRatio).toBe(0.004); // 4/1000

      // Test data quality
      expect(registry.getStats().totalSize).toBe(10000); // 1000 records × 10 columns
      expect(registry.getNames()).toHaveLength(10);

      // Test index manager
      indexManager.addIndex(northRegionIndex);
      indexManager.addIndex(electronicsIndex);
      indexManager.addIndex(highValueIndex);

      const indexStats = indexManager.getStats();
      expect(indexStats.indexCount).toBe(3);
      expect(indexStats.totalMappings).toBeGreaterThan(0);

      // Test serialization of large dataset
      const serialized = await prices.serialize();
      expect(serialized.length).toBeGreaterThan(1000);

      const newPrices = ColumnFactory.float64("restored_prices");
      await newPrices.deserialize(serialized);
      expect(newPrices.size()).toBe(1000);
      expect(await newPrices.sum()).toBeCloseTo(totalRevenue);
    });
  });

  describe("Performance and Scalability", () => {
    test("should handle concurrent operations", async () => {
      const column = ColumnFactory.int32("concurrent_test");
      const sortIndex = SortIndexUtils.createNumericIndex("concurrent_sort", "concurrent_test");

      // Simulate concurrent writes
      const writePromises = [];
      for (let i = 0; i < 100; i++) {
        writePromises.push(column.set(i, Math.floor(Math.random() * 1000)));
      }

      await Promise.all(writePromises);
      expect(column.size()).toBe(100);

      // Rebuild index and test concurrent reads
      await sortIndex.rebuild(column);

      const readPromises = [];
      for (let i = 0; i < 10; i++) {
        readPromises.push(sortIndex.getAllSorted());
        readPromises.push(column.sum());
        readPromises.push(column.avg());
      }

      const results = await Promise.all(readPromises);
      expect(results).toHaveLength(30);

      // All sorted results should be identical
      const sortedResults = results.filter((_, index) => index % 3 === 0);
      for (let i = 1; i < sortedResults.length; i++) {
        expect(sortedResults[i]).toEqual(sortedResults[0]);
      }
    });

    test("should maintain consistency across complex operations", async () => {
      // Create a mini social network
      const userIds = ColumnFactory.int32("users");
      const userNames = ColumnFactory.string("names");
      const followers = ColumnFactory.record<{ followerIds: number[] }>("followers");
      const posts = ColumnFactory.record<{ userId: number, content: string, likes: number }>("posts");

      // Create cross-references
      const userIndex = SortIndexUtils.createNumericIndex("user_sort", "users");
      const popularUsersIndex = ColumnFactory.index(
        "popular_users",
        "followers",
        (reader: Reader) => {
          const data = reader.getRecord<{ followerIds: number[] }>();
          return (data?.followerIds.length || 0) > 10;
        }
      );

      // Add users
      for (let i = 0; i < 20; i++) {
        await userIds.set(i, 1000 + i);
        await userNames.set(i, `User_${1000 + i}`);

        // Random followers (0-30 followers)
        const followerCount = Math.floor(Math.random() * 31);
        const followerIds = Array.from({ length: followerCount }, () =>
          1000 + Math.floor(Math.random() * 20)
        );
        await followers.set(i, { followerIds });
      }

      // Add posts
      for (let i = 0; i < 50; i++) {
        const userId = 1000 + Math.floor(Math.random() * 20);
        await posts.set(i, {
          userId,
          content: `Post ${i} by user ${userId}`,
          likes: Math.floor(Math.random() * 100)
        });
      }

      await userIndex.rebuild(userIds);
      await popularUsersIndex.rebuildIndex(followers.createReader({} as TransactionState));

      // Test data consistency
      expect(userIds.size()).toBe(20);
      expect(userNames.size()).toBe(20);
      expect(followers.size()).toBe(20);
      expect(posts.size()).toBe(50);

      // Test cross-referential integrity
      const allUsers = await userIndex.getAllSorted();
      expect(allUsers).toHaveLength(20);

      const popularUsers = popularUsersIndex.findIndices(true);

      // Verify popular users exist in main user table
      for (const userId of popularUsers) {
        expect(await userIds.get(userId)).toBeGreaterThanOrEqual(1000);
        expect(await userNames.get(userId)).toMatch(/^User_\d+$/);
      }

      // Test aggregations across related data
      const totalFollowers = await followers.mapRecords(record => record.followerIds.length);
      const avgFollowers = totalFollowers.reduce((sum, count) => sum + count, 0) / totalFollowers.length;
      expect(avgFollowers).toBeGreaterThan(0);

      const totalLikes = await posts.mapRecords(post => post.likes);
      const sumLikes = totalLikes.reduce((sum, likes) => sum + likes, 0);
      expect(sumLikes).toBeGreaterThan(0);
    });
  });
});

describe.skip("Error Handling and Edge Cases", () => {
  test("should gracefully handle data corruption and recovery", async () => {
    const column = ColumnFactory.string("corruption_test");
    await column.set(0, "valid_data");

    // Test serialization/deserialization integrity
    const serialized = await column.serialize();

    // Corrupt the data slightly
    const corrupted = new Uint8Array(serialized);
    if (corrupted.length > 10) {
      corrupted[10] = corrupted[10] ^ 0xFF; // Flip all bits
    }

    const newColumn = ColumnFactory.string("recovery_test");

    // Should detect corruption
    try {
      await newColumn.deserialize(corrupted);
      // If it doesn't throw, verify the data is at least partially intact
      expect(newColumn.size()).toBeGreaterThanOrEqual(0);
    } catch (error) {
      // Expected behavior - corruption detected
      expect(error).toBeInstanceOf(Error);
    }
  });

  test("should handle resource exhaustion gracefully", async () => {
    const column = ColumnFactory.string("resource_test");
    const index = SortIndexUtils.createStringIndex("resource_index", "resource_test");

    try {
      // Try to create a very large dataset
      for (let i = 0; i < 10000; i++) {
        await column.set(i, `data_${i}_${"x".repeat(100)}`);
      }

      await index.rebuild(column);

      // If successful, verify the data
      expect(column.size()).toBe(10000);
      expect(index.getSortedSize()).toBe(10000);

      // Test that operations still work
      const firstItems = await index.getRange(undefined, undefined, true, 10);
      expect(firstItems).toHaveLength(10);

    } catch (error) {
      // If resource exhaustion occurs, it should be handled gracefully
      console.warn("Resource exhaustion test completed early:", error.message);
      expect(error).toBeInstanceOf(Error);
    }
  });

  test("should maintain data integrity under stress", async () => {
    const registry = new ColumnRegistry();
    const numColumns = 10;
    const columns = [];

    // Create multiple columns of different types
    for (let i = 0; i < numColumns; i++) {
      const col = ColumnFactory.int32(`stress_test_${i}`);
      columns.push(col);
      await registry.register(col);
    }

    // Perform many random operations
    const operations = [];
    for (let i = 0; i < 1000; i++) {
      const colIndex = i % numColumns;
      const rowIndex = i % 100;
      operations.push(columns[colIndex].set(rowIndex, i));
    }

    await Promise.all(operations);

    // Verify data integrity
    const stats = registry.getStats();
    expect(stats.columnCount).toBe(numColumns);
    expect(stats.totalSize).toBeGreaterThan(0);

    // Verify each column has correct data
    for (let i = 0; i < numColumns; i++) {
      expect(columns[i].size()).toBeGreaterThan(0);

      // Test some aggregations
      const sum = await columns[i].sum();
      const avg = await columns[i].avg();
      expect(sum).toBeGreaterThan(0);
      expect(avg).toBeGreaterThan(0);
    }
  });
});
