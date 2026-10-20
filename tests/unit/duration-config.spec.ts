import { describe, expect, it } from "vitest";

import {
  getDefaultDurationForCategory,
  parseCleaningDurationConfig,
  resolveEquipmentDurationFromConfig,
} from "../../src/lib/laundry-equipment/duration-config";

describe("duration-config", () => {
  it("getDefaultDurationForCategory returns accurate defaults", () => {
    expect(getDefaultDurationForCategory("DISINFECT", "disinfection_tank")).toBe(30);
    expect(getDefaultDurationForCategory("消毒品", "washer")).toBe(60);
    expect(getDefaultDurationForCategory("感染污物", "dryer")).toBe(60);

    expect(getDefaultDurationForCategory("SOILED")).toBe(60);
    expect(getDefaultDurationForCategory("汙衣")).toBe(60);
    expect(getDefaultDurationForCategory("污衣類")).toBe(60);

    expect(getDefaultDurationForCategory("BIB")).toBe(20);
    expect(getDefaultDurationForCategory("圍兜")).toBe(20);
    expect(getDefaultDurationForCategory("快烘")).toBe(20);
    expect(getDefaultDurationForCategory("QUICK_DRY")).toBe(20);
    expect(getDefaultDurationForCategory("DRY")).toBe(20);

    expect(getDefaultDurationForCategory("CURTAIN")).toBe(40);
    expect(getDefaultDurationForCategory("床簾")).toBe(40);

    expect(getDefaultDurationForCategory("OTHER")).toBe(60);
    expect(getDefaultDurationForCategory("一般")).toBe(60);
    expect(getDefaultDurationForCategory("")).toBe(60);
    expect(getDefaultDurationForCategory("", "disinfection_tank")).toBe(30);
  });

  it("parseCleaningDurationConfig handles valid and invalid inputs", () => {
    const jsonStr = JSON.stringify({
      default: 60,
      DISINFECT: 90,
      SOILED: 75,
      BIB: 45,
    });

    const parsed = parseCleaningDurationConfig(jsonStr, 60);
    expect(parsed.default).toBe(60);
    expect(parsed.DISINFECT).toBe(90);
    expect(parsed.SOILED).toBe(75);
    expect(parsed.BIB).toBe(45);

    // Object input
    const fromObj = parseCleaningDurationConfig({ default: 50, DISINFECT: 100 });
    expect(fromObj.default).toBe(50);
    expect(fromObj.DISINFECT).toBe(100);

    // Corrupted / empty input
    const fallback = parseCleaningDurationConfig("not-json", 70);
    expect(fallback.default).toBe(70);

    const empty = parseCleaningDurationConfig(null, 80);
    expect(empty.default).toBe(80);

    // Out of bounds values filtered
    const bounded = parseCleaningDurationConfig({ default: 60, INVALID: -10, OVER: 9999 });
    expect(bounded.INVALID).toBeUndefined();
    expect(bounded.OVER).toBeUndefined();
  });

  it("resolveEquipmentDurationFromConfig matches category correctly", () => {
    const config = {
      default: 60,
      DISINFECT: 90,
      SOILED: 75,
      BIB: 45,
    };

    // Exact code
    expect(resolveEquipmentDurationFromConfig(config, "DISINFECT")).toBe(90);
    expect(resolveEquipmentDurationFromConfig(config, "SOILED")).toBe(75);
    expect(resolveEquipmentDurationFromConfig(config, "BIB")).toBe(45);

    // Semantic Chinese name to code mapping
    expect(resolveEquipmentDurationFromConfig(config, "消毒品")).toBe(90);
    expect(resolveEquipmentDurationFromConfig(config, "汙衣")).toBe(75);
    expect(resolveEquipmentDurationFromConfig(config, "圍兜")).toBe(45);

    // Unconfigured category falls back to default
    expect(resolveEquipmentDurationFromConfig(config, "CURTAIN")).toBe(40);
    expect(resolveEquipmentDurationFromConfig(config, "一般")).toBe(60);
    expect(resolveEquipmentDurationFromConfig(config, "快烘")).toBe(20);
    expect(resolveEquipmentDurationFromConfig(config, "QUICK_DRY")).toBe(20);
    expect(resolveEquipmentDurationFromConfig(config, null)).toBe(60);

    // Null config falls back to fallback parameter
    expect(resolveEquipmentDurationFromConfig(null, "OTHER", 45)).toBe(45);
    expect(resolveEquipmentDurationFromConfig(null, null, 45)).toBe(45);
  });
});
