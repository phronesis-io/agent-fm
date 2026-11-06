import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../../src/server.ts";
test("desktop pairing, Chinese message, timer, privacy and deletion", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-browser-"));
  const app = await serve(dir, resolve("web"), { connect: false });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
    await expect(page.getByText("Codex 离线", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await page.getByPlaceholder("写一句话给 Codex…").fill("今天想慢慢看书。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".message.user")).toContainText(
      "今天想慢慢看书。",
    );
    await page.reload();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(page.locator(".message.user")).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator(".artwork")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "收起聊天" }).click();
    await page.getByRole("button", { name: "开始", exact: true }).click();
    const player = page.locator("audio");
    await expect(page.locator("#remaining")).toHaveText("25");
    await expect(player).toHaveJSProperty("paused", false);
    await expect(page.getByRole("button", { name: "暂停音乐" })).toBeHidden();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(player).toHaveJSProperty("paused", true);
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await expect(player).toHaveJSProperty("paused", false);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(player).toHaveJSProperty("paused", true);
    await page.getByRole("button", { name: "看画" }).click();
    await expect(
      page.getByRole("button", { name: "Codex", exact: true }),
    ).toBeHidden();
    await expect(page.locator("#label")).toBeHidden();
    await page.getByRole("button", { name: "回到房间" }).click();
    await page.getByRole("button", { name: "记录", exact: true }).click();
    await expect(page.locator("#pomodoro-log")).toContainText("已暂停");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "删除这段记录" }).click();
    await expect(page.locator(".history-session")).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "收起历史" }).click();
    await expect(page.locator("#today-count")).toHaveText("今天完成 0 个");
    await page.getByRole("button", { name: "播放音乐" }).click();
    await expect(page.locator("#wave")).toHaveAttribute("d", /v/);
    const path = page.locator("#wave");
    const initial = await path.getAttribute("d");
    await expect.poll(() => path.getAttribute("d")).not.toBe(initial);
    await page.getByRole("button", { name: "暂停音乐" }).click();
    const frozen = await path.getAttribute("d");
    await page.waitForTimeout(250);
    expect(await path.getAttribute("d")).toBe(frozen);

    await page.screenshot({
      path: "test-results/desktop-space.png",
      fullPage: true,
    });
  } finally {
    await page.close();
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("night mode keeps the clock and conversation readable", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-night-"));
  const app = await serve(dir, resolve("web"), { connect: false });
  try {
    app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
    await page.getByRole("button", { name: "打开设置" }).click();
    await page.locator("#night").check();
    await expect(page.locator("body")).toHaveClass(/night/);
    await page.getByRole("button", { name: "收起设置" }).click();
    await page.screenshot({ path: "test-results/night-space.png" });
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    for (const [foreground, surface] of [
      ["#remaining", "body"],
      ["#station-caption", "body"],
      ["#chat h2", "#chat"],
      ["#message", "#message"],
      ["#chat .primary", "#chat .primary"],
    ]) {
      const ratio = await page.evaluate(
        ([fg, bg]) => {
          function luminance(rgb: string) {
            const [r, g, b] = rgb
              .match(/[\d.]+/g)!
              .map(Number)
              .slice(0, 3)
              .map((v) => v / 255)
              .map((v) =>
                v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
              );
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          }
          const a = luminance(
              getComputedStyle(document.querySelector(fg)!).color,
            ),
            b = luminance(
              getComputedStyle(document.querySelector(bg)!).backgroundColor,
            );
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        },
        [foreground, surface],
      );
      expect(ratio, foreground).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await page.close();
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clear all asks first and clears persisted local records", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-clear-"));
  const app = await serve(dir, resolve("web"), { connect: false });
  try {
    app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
    await expect(page.locator("#label")).toBeVisible();
    // Static artwork can render before the one-time browser pairing finishes.
    // Direct API setup must wait for authenticated app state, like UI actions do.
    await expect(page.locator("#clock")).toBeEnabled();
    const call = (path: string, data: object) =>
      page.evaluate(
        async ({ path, data }) => {
          const res = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!res.ok) throw Error(await res.text());
        },
        { path, data },
      );
    await call("/api/timer", { action: "start" });
    await call("/api/record", {
      kind: "favorite-source",
      detail: "test-only music",
    });
    await call("/api/timer", { action: "end" });
    await call("/api/messages", {
      id: "test-clear-message",
      text: "test-only message",
    });
    await call("/api/timer", { action: "start" });
    await page.getByRole("button", { name: "记录" }).click();
    const clear = page.getByRole("button", { name: "清空所有记录" });
    page.once("dialog", (d) => d.dismiss());
    await clear.click();
    await expect(page.locator(".history-session")).toHaveCount(2);
    page.once("dialog", (d) => d.accept());
    await clear.click();
    await expect(page.locator(".history-session")).toHaveCount(0);
    await page.reload();
    const data = await page.evaluate(async () =>
      (await fetch("/api/export")).json(),
    );
    for (const k of ["sessions", "events", "notes", "runs"])
      expect(data[k]).toEqual([]);
    await expect(
      page.getByRole("button", { name: "开始", exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
