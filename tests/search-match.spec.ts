import { expect, test } from "@playwright/test";
import { scoreSearchFields, SEARCH_RANK, workItemSearchRank } from "../src/lib/search-match";

const items = [
  { part_id: "SK-000000", item_title: "Setup-01-3 axis mills", department_name: "3 Axis Vertical Mills" },
  { part_id: "p-100033", item_title: "testing", department_name: "3 Axis Vertical Mills" },
  { part_id: "pg-8280", item_title: "Pouring Instructions", department_name: "Tool Room" },
  { part_id: "T-01", item_title: "Test Phone Media", department_name: "3 Axis Vertical Mills" },
];
const matching = (query: string) => items.filter((item) => workItemSearchRank(item, query) > 0).map((item) => item.part_id);

test("one letter finds only the part numbers that start with it, not titles that contain it", () => {
  expect(matching("p")).toEqual(["p-100033", "pg-8280"]);
  expect(matching("P")).toEqual(["p-100033", "pg-8280"]);
  expect(matching("s")).toEqual(["SK-000000"]);
});

test("part numbers match without dashes or spaces, and an exact scan ranks first", () => {
  expect(matching("pg8280")).toEqual(["pg-8280"]);
  expect(matching("PG 82")).toEqual(["pg-8280"]);
  expect(workItemSearchRank(items[2], "PG-8280")).toBe(SEARCH_RANK.exactPart);
  expect(workItemSearchRank(items[2], "pg-8")).toBe(SEARCH_RANK.partStart);
  expect(workItemSearchRank(items[2], "8280")).toBe(SEARCH_RANK.partContains);
  // Two characters are too few to search inside part numbers.
  expect(matching("28")).toEqual([]);
});

test("longer searches also find the start of words in titles and department names", () => {
  expect(matching("pour")).toEqual(["pg-8280"]);
  expect(matching("ph")).toEqual(["T-01"]);
  expect(matching("axis mills")).toEqual(["SK-000000", "p-100033", "T-01"]);
  expect(matching("tool")).toEqual(["pg-8280"]);
  // Letters in the middle of a word do not count ("Setup" does not match "tup").
  expect(matching("tup")).toEqual([]);
});

test("documents and formulas: one letter matches the start of their number or name only", () => {
  expect(scoreSearchFields("q", ["QMS-001", "Production release and traceability procedure"])).toBeGreaterThan(0);
  expect(scoreSearchFields("p", ["QMS-001", "Production release and traceability procedure"])).toBe(0);
  expect(scoreSearchFields("trace", ["QMS-001", "Production release and traceability procedure"])).toBeGreaterThan(0);
  expect(scoreSearchFields("qms001", ["QMS-001", "Production release"])).toBeGreaterThan(
    scoreSearchFields("release", ["QMS-001", "Production release"]),
  );
});
