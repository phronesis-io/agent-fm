import { expect, test as base, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../../src/server.ts";

const test = base.extend<{ room: Page }>({
  room: async ({ page }, use) => {
    const dir = mkdtempSync(join(tmpdir(), "fm-stations-"));
    const app = await serve(dir, resolve("web"), { connect: false });
    try {
      await page.route("https://www.youtube-nocookie.com/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Test broadcast</title>",
        }),
      );
      app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
      await expect(page.locator("#clock")).toHaveAccessibleName("开始");
      await use(page);
    } finally {
      await page.close();
      await app.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

const frame = (page: Page) => page.locator("#radio-frame iframe");

async function choose(page: Page, name: string) {
  await page.locator("#station-open").click();
  await page.locator(`#station-shelf button[data-title="${name}"]`).click();
  await expect(page.locator("#station-caption")).toContainText(name);
  await expect(page.locator("#station-shelf")).toBeHidden();
}

const session = (page: Page) =>
  page.evaluate(async () =>
    (await (await fetch("/api/state")).json()).sessions.at(-1),
  );

test("tune in with two actions, keep the current choice visible and preserve clock state", async ({
  room,
}) => {
  await choose(room, "Claude FM");
  await expect(room.locator("#station-caption")).toBeVisible();
  await expect(room.locator("#clock")).toHaveAccessibleName("开始");
  await expect(frame(room)).toHaveAttribute("src", /embed\/tRsQsTMvPNg/);
  await expect(room.locator("audio")).toHaveJSProperty("paused", true);

  await room.locator("#clock").click();
  await expect(room.locator("#clock")).toHaveAccessibleName("暂停");
  const { deadline } = await session(room);
  await choose(room, "Lofi Girl");
  expect((await session(room)).deadline).toBe(deadline);
  await room.locator("#clock").click();
  await expect(room.locator("#clock")).toHaveAccessibleName("继续");
  const { remaining } = await session(room);
  await choose(room, "Chillhop Music");
  await expect(frame(room)).toHaveCount(0);
  expect((await session(room)).remaining).toBe(remaining);
  await room.locator("#clock").click();
  await expect(frame(room)).toHaveAttribute("src", /embed\/jiua2V9q9V0/);
  await room.reload();
  await expect(room.locator("#station-caption")).toContainText(
    "Chillhop Music",
  );
  await expect(frame(room)).toHaveCount(0);
  await room.locator("#station-open").click();
  await room.locator("#restore-track").click();
  await expect(room.locator("#station-caption")).not.toContainText(
    "Chillhop Music",
  );
  await expect(frame(room)).toHaveCount(0);
});

test("keyboard users can open and dismiss the station shelf and recover focus", async ({
  room,
}) => {
  const trigger = room.locator("#station-open");
  await trigger.focus();
  await room.keyboard.press("Enter");
  await expect(room.locator("#station-shelf")).toBeVisible();
  await room.keyboard.press("Escape");
  await expect(room.locator("#station-shelf")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("a rejected link preserves the source, and an earlier lookup cannot replace a newer choice", async ({
  room,
}) => {
  await choose(room, "Claude FM");
  const input = room.locator("#radio-url");
  await room.locator("#station-open").click();
  await room.route("**/api/radio", (route) =>
    route.fulfill({ status: 400, json: { error: "找不到这个频道" } }),
  );
  await input.fill("https://www.youtube.com/@not-live");
  await input.press("Enter");
  await expect(room.locator("#radio-status")).toContainText("找不到这个频道");
  await expect(room.locator("#station-shelf")).toBeVisible();
  await expect(room.locator("#station-caption")).toContainText("Claude FM");

  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  await room.unroute("**/api/radio");
  await room.route("**/api/radio", async (route) => {
    await wait;
    await route
      .fulfill({ json: { id: "tRsQsTMvPNg", title: "过期的自定义频道" } })
      .catch(() => {});
  });
  await input.fill("https://www.youtube.com/@delayed");
  const started = room.waitForRequest("**/api/radio");
  await input.press("Enter");
  await started;
  try {
    await room.locator('#station-shelf button[data-title="Lofi Girl"]').click();
    const settled = room.waitForEvent("requestfinished", (r) =>
      r.url().endsWith("/api/radio"),
    );
    release();
    await settled;
    await room.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    await expect(room.locator("#station-caption")).toContainText("Lofi Girl");
    await expect(frame(room)).toHaveAttribute("src", /embed\/4t4AQ15yj1M/);
  } finally {
    release();
  }
});

test("tuning in from a second tab releases the player in the first tab", async ({
  room,
}) => {
  await choose(room, "Claude FM");
  const second = await room.context().newPage();
  try {
    await second.goto(new URL("/", room.url()).href);
    // Both tabs share the chosen station, but a new tab initially stays silent.
    await expect(second.locator("#station-caption")).toContainText("Claude FM");
    await expect(frame(second)).toHaveCount(0);
    await second.locator("#station-open").click();
    await second.locator("#restore-track").click();
    await expect(second.locator("audio")).toHaveJSProperty("paused", false);
    await expect(frame(room)).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test("a tuned station owns the main canvas while the clock and controls stay usable", async ({
  room,
}) => {
  const title = "Claude FM 🎵 music for thinking and building · 放送中 ".repeat(
    4,
  );
  await room.route("**/api/radio", (route) =>
    route.fulfill({ json: { id: "tRsQsTMvPNg", title } }),
  );
  await room.locator("#station-open").click();
  await room.locator("#radio-url").fill("https://youtu.be/tRsQsTMvPNg");
  await room.locator("#radio-url").press("Enter");
  await expect(room.locator("#station-caption")).toHaveText(title.trim());
  await room.locator("#clock").click();
  await expect(frame(room)).toHaveCount(1);
  await expect(room.locator("#label")).toBeHidden();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    await room.setViewportSize(size);
    const stage = (await frame(room).boundingBox())!;
    expect(stage.width).toBeGreaterThanOrEqual(size.width * 0.9);
    expect(stage.height).toBeGreaterThanOrEqual(size.height * 0.6);
    await room.locator("#station-open").click();
    for (const id of [
      "#clock",
      "#station-open",
      "#station-close",
      "#radio-original",
      "#radio-url",
      "#chat-toggle",
      "#fullscreen",
    ]) {
      const control = room.locator(id);
      await expect(control).toBeInViewport();
      expect(
        await control.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
        `${id} at ${size.width}×${size.height}`,
      ).toBeTruthy();
    }
    await room.locator("#station-close").click();
  }
  // Returning to this edition brings the artwork and label back.
  await room.locator("#station-open").click();
  await room.locator("#restore-track").click();
  await expect(room.locator("#label")).toBeVisible();
  await expect(room.locator("#radio-screen")).toBeHidden();
});
