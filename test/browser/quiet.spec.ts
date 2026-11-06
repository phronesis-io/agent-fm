import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../../src/server.ts";
import { record } from "../../src/budget.ts";

test("keep a set, bring it to chat as a draft, see the week and the ledger", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-quiet-"));
  const app = await serve(dir, resolve("web"), { connect: false });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
    await expect(page.locator("#clock")).toHaveAccessibleName("开始");

    // Fact layer: on the page, with sources; no Codex text, no chat controls.
    const label = page.locator("#label");
    await expect(label).toBeVisible();
    await expect(page.locator("#label-title")).not.toBeEmpty();
    await expect(page.locator("#label-shelf")).toContainText(/精选|漫游/);
    await expect(page.locator("#label-source")).toHaveAttribute("href", /metmuseum|clevelandart/);
    await expect(label.getByText("Codex")).toHaveCount(0);
    await expect(label.getByRole("button", { name: "带去聊" })).toHaveCount(0);
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(page.locator("#toast")).toContainText("已收藏");
    await expect(page.locator("#keep-edition")).toHaveText("已收藏");
    await expect(page.locator("#keep-edition")).toBeDisabled();
    await page.getByRole("button", { name: "收起说明" }).click();
    await expect(page.locator("#label-body")).toBeHidden();
    await expect(page.locator("#label-title")).toBeVisible();
    await page.getByRole("button", { name: "展开说明" }).click();
    await expect(page.locator("#label-body")).toBeVisible();

    // Chat layer: attaching facts is a chat action and sends nothing.
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await page.getByRole("button", { name: "附上这一组的事实" }).click();
    await expect(page.locator("#reading-context")).toBeVisible();
    await expect(page.locator("#message")).toHaveValue("想聊聊这一组。");
    // Staging a draft never sends a message.
    expect(app.store.read().runs.length).toBe(0);
    await page.getByRole("button", { name: "收起聊天" }).click();

    await page.getByRole("button", { name: "记录", exact: true }).click();
    await expect(page.locator("#week li")).toHaveCount(7);
    await expect(page.locator(".history-session .kept")).toHaveCount(1);
    await page.locator(".history-session .kept button").click();
    await expect(page.locator("#chat")).toBeVisible();
    await expect(page.locator("#message")).toHaveValue("想聊聊我收藏的这组画作和音乐。");
    expect(app.store.read().runs.length).toBe(0);
    await page.getByRole("button", { name: "收起聊天" }).click();

    await page.getByRole("button", { name: "打开设置" }).click();
    await expect(page.locator("#ledger-summary")).toHaveText("今天还没有调用 Codex。");
    await expect(page.locator("#day-close")).not.toBeChecked();
    await expect(page.locator("#curate-next")).not.toBeChecked();
    app.store.update((s) => {
      record(s, "curate", "采用");
      record(s, "chat", "完成");
    });
    app.engine.changed();
    await expect(page.locator("#ledger-summary")).toHaveText(
      "今天调用 2 次 · 选下一组 1/12",
    );
    await expect(page.locator("#ledger-items li")).toHaveCount(2);
    const text = await page.locator("#ledger").innerText();
    expect(text).not.toContain("想聊聊");
    await page.screenshot({ path: "test-results/settings-ledger.png" });
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "收起设置" }).click();
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      for (const name of ["看画", "全屏"]) {
        const b = page.getByRole("button", { name, exact: true });
        await expect(b).toBeInViewport();
        await expect(b).toHaveCSS("opacity", "1");
      }
      const l = (await label.boundingBox())!;
      const c = (await page.locator("#clock").boundingBox())!;
      expect(l.x + l.width <= c.x || c.x + c.width <= l.x).toBe(true);
      await page.screenshot({ path: `test-results/label-${size.width}.png` });
    }
  } finally {
    await page.close();
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
