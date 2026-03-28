import { test, expect, type Page } from "@playwright/test";

function h(page: Page) {
  return {
    async getLoadError() {
      return page.evaluate(() => window.testHarness.getLoadError());
    },
    async getItemCount() {
      return page.evaluate(() => window.testHarness.getItemCount());
    },
    async getWireCount() {
      return page.evaluate(() => window.testHarness.getWireCount());
    },
    async getJunctionCount() {
      return page.evaluate(() => window.testHarness.getJunctionCount());
    },
    async getNoConnectCount() {
      return page.evaluate(() => window.testHarness.getNoConnectCount());
    },
    async getLabelCount() {
      return page.evaluate(() => window.testHarness.getLabelCount());
    },
    async getSymbolCount() {
      return page.evaluate(() => window.testHarness.getSymbolCount());
    },
    async getSymbolReferences() {
      return page.evaluate(() => window.testHarness.getSymbolReferences());
    },
    async getSymbolValues() {
      return page.evaluate(() => window.testHarness.getSymbolValues());
    },
    async getActiveTool() {
      return page.evaluate(() => window.testHarness.getActiveTool());
    },
    async getSelectionSize() {
      return page.evaluate(() => window.testHarness.getSelectionSize());
    },
    async clickAt(x: number, y: number, opts?: { shift?: boolean; dbl?: boolean }) {
      return page.evaluate(([x, y, opts]) => window.testHarness.clickAt(x, y, opts), [x, y, opts ?? {}] as const);
    },
    async moveTo(x: number, y: number) {
      return page.evaluate(([x, y]) => window.testHarness.moveTo(x, y), [x, y] as const);
    },
    async pressKey(key: string, opts?: { ctrl?: boolean; shift?: boolean }) {
      return page.evaluate(([k, o]) => window.testHarness.pressKey(k, o), [key, opts ?? {}] as const);
    },
  };
}

test.describe("unified renderer - load test schematic", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3999/unified-harness.html");
    await expect(page.locator("#status")).toHaveText("ready");
  });

  test("loads schematic without errors", async ({ page }) => {
    const t = h(page);
    expect(await t.getLoadError()).toBeNull();
  });

  test("has correct number of wires", async ({ page }) => {
    const t = h(page);
    expect(await t.getWireCount()).toBe(3);
  });

  test("has correct number of junctions", async ({ page }) => {
    const t = h(page);
    expect(await t.getJunctionCount()).toBe(1);
  });

  test("has correct number of no-connects", async ({ page }) => {
    const t = h(page);
    expect(await t.getNoConnectCount()).toBe(1);
  });

  test("has correct number of labels", async ({ page }) => {
    const t = h(page);
    expect(await t.getLabelCount()).toBe(1);
  });

  test("has correct number of symbols", async ({ page }) => {
    const t = h(page);
    expect(await t.getSymbolCount()).toBe(2);
  });

  test("symbols have correct references", async ({ page }) => {
    const t = h(page);
    const refs = await t.getSymbolReferences();
    expect(refs).toContain("R1");
    expect(refs).toContain("R2");
  });

  test("symbols have correct values", async ({ page }) => {
    const t = h(page);
    const vals = await t.getSymbolValues();
    expect(vals).toContain("10k");
    expect(vals).toContain("4.7k");
  });

  test("total item count matches", async ({ page }) => {
    const t = h(page);
    // 3 wires + 1 junction + 1 no-connect + 1 label + 2 symbols = 8
    expect(await t.getItemCount()).toBe(8);
  });
});

test.describe("unified renderer - editing on loaded schematic", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3999/unified-harness.html");
    await expect(page.locator("#status")).toHaveText("ready");
  });

  test("can add junction to existing schematic", async ({ page }) => {
    const t = h(page);
    const before = await t.getJunctionCount();

    await t.pressKey("j");
    await t.clickAt(35, 20);

    expect(await t.getJunctionCount()).toBe(before + 1);
  });

  test("can draw wire on existing schematic", async ({ page }) => {
    const t = h(page);
    const before = await t.getWireCount();

    await t.pressKey("w");
    await t.clickAt(40, 20);
    await t.moveTo(50, 20);
    await t.clickAt(50, 20, { dbl: true });

    expect(await t.getWireCount()).toBeGreaterThan(before);
  });

  test("can undo edits on loaded schematic", async ({ page }) => {
    const t = h(page);
    const before = await t.getJunctionCount();

    await t.pressKey("j");
    await t.clickAt(60, 60);
    expect(await t.getJunctionCount()).toBe(before + 1);

    await t.pressKey("z", { ctrl: true });
    expect(await t.getJunctionCount()).toBe(before);
  });

  test("can redo edits on loaded schematic", async ({ page }) => {
    const t = h(page);
    const before = await t.getJunctionCount();

    await t.pressKey("j");
    await t.clickAt(60, 60);
    await t.pressKey("z", { ctrl: true });
    expect(await t.getJunctionCount()).toBe(before);

    await t.pressKey("z", { ctrl: true, shift: true });
    expect(await t.getJunctionCount()).toBe(before + 1);
  });

  test("can place no-connect on loaded schematic", async ({ page }) => {
    const t = h(page);
    const before = await t.getNoConnectCount();

    await t.pressKey("q");
    await t.clickAt(70, 70);

    expect(await t.getNoConnectCount()).toBe(before + 1);
  });

  test("can place label on loaded schematic", async ({ page }) => {
    const t = h(page);
    const before = await t.getLabelCount();

    await t.pressKey("l");
    await t.clickAt(55, 20);

    expect(await t.getLabelCount()).toBe(before + 1);
  });

  test("tool switching works on loaded schematic", async ({ page }) => {
    const t = h(page);

    await t.pressKey("w");
    expect(await t.getActiveTool()).toBe("wire");

    await t.pressKey("Escape");
    expect(await t.getActiveTool()).toBe("select");

    await t.pressKey("j");
    expect(await t.getActiveTool()).toBe("junction");
  });
});
