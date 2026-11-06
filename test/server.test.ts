import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../src/server.ts";
test("loopback auth, origin, one-time pairing and durable browser message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-http-"));
  const app = await serve(dir, resolve("web"), { connect: false });
  try {
    assert.equal((await fetch(app.origin + "/api/state")).status, 401);
    assert.equal(
      (
        await fetch(app.origin + "/api/messages", {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const key = new URL(app.issueLink()).hash.slice(6);
    const paired = await fetch(app.origin + "/api/pair", {
      method: "POST",
      headers: { Origin: app.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    assert.equal(paired.status, 200);
    const cookie = paired.headers.get("set-cookie")!.split(";")[0];
    const again = await fetch(app.origin + "/api/pair", {
      method: "POST",
      headers: { Origin: app.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    assert.equal(again.status, 401);
    const headers = {
      Origin: app.origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    };
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await fetch(app.origin + "/api/messages", {
            method: "POST",
            headers,
            body: JSON.stringify({ id: "12345678", text: "hello" }),
          })
        ).status,
        202,
      );
    assert.equal(app.store.read().runs.length, 1);
    assert.equal(
      (
        await fetch(app.origin + "/api/messages", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(app.origin + "/api/open", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      404,
    );
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a paired bookmark survives a bridge restart at the same origin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-bookmark-"));
  let app = await serve(dir, resolve("web"), { connect: false });
  try {
    const origin = app.origin;
    const post = (path: string, data: unknown) =>
      fetch(origin + path, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    const paired = await post("/api/pair", {
      key: new URLSearchParams(new URL(app.issueLink()).hash.slice(1)).get(
        "pair",
      ),
    });
    const { proof } = await paired.json();
    await app.stop();
    app = await serve(dir, resolve("web"), { connect: false });
    assert.equal(app.origin, origin);
    assert.equal(
      (await post("/api/browser-resume", { proof: "invalid" })).status,
      401,
    );
    const resumed = await post("/api/browser-resume", { proof });
    assert.equal(resumed.status, 200);
    const cookie = resumed.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await fetch(origin + "/api/state", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
