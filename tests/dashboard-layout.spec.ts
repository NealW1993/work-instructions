import { expect, test } from "@playwright/test";
import {
  DASHBOARD_LAYOUT_PRESETS, DASHBOARD_WIDGET_IDS,
  findMatchingDashboardLayoutPreset, getDefaultDashboardLayout,
  isSameDashboardLayout, normalizeDashboardLayout, parseDashboardLayout,
} from "../src/lib/dashboard-layout";

test("new profiles and historical empty arrays get a usable first-use homepage", () => {
  const expected = getDefaultDashboardLayout();
  for (const value of [null, undefined, [], {}, "invalid"]) expect(normalizeDashboardLayout(value)).toEqual(expected);
  expect(expected.some((widget) => widget.visible)).toBe(true);
  expect(findMatchingDashboardLayoutPreset([])?.id).toBe("plant_floor");
  // Operators start with search, pinned work, and recent changes rather than every insight panel.
  expect(expected.filter((widget) => widget.visible).map((widget) => widget.id)).toEqual(["finder", "pinned", "recent_updates", "newest", "review_queue"]);
});

test("an intentionally empty homepage stays empty after normalization and subsequent saves", () => {
  const hidden = getDefaultDashboardLayout().map((widget) => ({ ...widget, visible: false }));
  const saved = parseDashboardLayout(hidden);
  expect(saved).not.toBeNull();
  expect(normalizeDashboardLayout(saved).every((widget) => !widget.visible)).toBe(true);
  expect(normalizeDashboardLayout(normalizeDashboardLayout(saved))).toEqual(hidden);
});

test("personalized layouts keep their order and sizes while missing widgets remain hidden", () => {
  const partial = [{ id: "pinned", visible: true, size: "wide" }, { id: "finder", visible: false, size: "compact" }];
  const normalized = normalizeDashboardLayout(partial);
  expect(normalized.slice(0, 2)).toEqual(partial);
  expect(normalized).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  expect(new Set(normalized.map((widget) => widget.id)).size).toBe(DASHBOARD_WIDGET_IDS.length);
  expect(normalized.slice(2).every((widget) => !widget.visible)).toBe(true);
});

test("retired widgets and isolated damaged rows cannot erase the remaining saved layout", () => {
  const normalized = normalizeDashboardLayout([
    { id: "retired_machine_chart", visible: true, size: "wide" },
    { id: "pinned", visible: true, size: "wide" },
    { id: "finder", visible: "false", size: "full" },
    null,
    { id: "newest", visible: true, size: "compact" },
    { id: "pinned", visible: false, size: "full" },
  ]);
  expect(normalized.slice(0, 2)).toEqual([{ id: "pinned", visible: true, size: "wide" }, { id: "newest", visible: true, size: "compact" }]);
  expect(normalized.find((widget) => widget.id === "finder")?.visible).toBe(false);
  expect(normalized.some((widget) => String(widget.id) === "retired_machine_chart")).toBe(false);
  expect(normalizeDashboardLayout([{ id: "only_retired_widget", visible: true, size: "wide" }])).toEqual(getDefaultDashboardLayout());
});

test("new saves reject malformed layouts instead of coercing or silently dropping widgets", () => {
  const valid = { id: "finder", visible: true, size: "full" };
  for (const value of [
    null, {}, [null], [[valid]], [{ ...valid, visible: "false" }], [{ ...valid, size: "gigantic" }],
    [{ ...valid, id: "retired_widget" }], [valid, valid], Array(200).fill(valid), [{ ...valid, id: "__proto__" }],
  ]) expect(parseDashboardLayout(value)).toBeNull();
  expect(parseDashboardLayout([{ ...valid, extra: "discarded" }])).toEqual([valid]);
  expect(parseDashboardLayout([])).toEqual([]);
});

test("layout copies cannot mutate presets or another user's setup", () => {
  const first = getDefaultDashboardLayout();
  const second = getDefaultDashboardLayout();
  first[0].visible = !first[0].visible;
  first.reverse();
  expect(getDefaultDashboardLayout()).toEqual(second);
  const normalized = normalizeDashboardLayout(second);
  normalized[0].size = "compact";
  expect(second[0].size).not.toBe("compact");
});

test("every preset contains each available widget once and is recognized without changing saved order", () => {
  for (const preset of DASHBOARD_LAYOUT_PRESETS) {
    expect(preset.description.trim()).not.toBe("");
    expect(parseDashboardLayout(preset.layout)).not.toBeNull();
    expect(preset.layout).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(findMatchingDashboardLayoutPreset(preset.layout)?.id).toBe(preset.id);
    expect(isSameDashboardLayout(normalizeDashboardLayout(preset.layout), preset.layout)).toBe(true);
    expect(isSameDashboardLayout([...preset.layout].reverse(), preset.layout)).toBe(false);
  }
});
