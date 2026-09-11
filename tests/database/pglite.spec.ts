import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("測試程序可以啟動 PostgreSQL 相容資料庫", async () => {
  database = await createTestDatabase();

  const result = await database.query<{ answer: number }>(
    "select 42::integer as answer",
  );

  expect(result.rows).toEqual([{ answer: 42 }]);
});
