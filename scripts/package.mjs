import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
const root = "artifacts/agent-fm";
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp("dist", `${root}/dist`, { recursive: true });
await cp("skill", `${root}/skill`, { recursive: true });
await cp("INSTALL.md", `${root}/INSTALL.md`);
execFileSync("tar", [
  "-czf",
  "artifacts/agent-fm-0.1.0.tar.gz",
  "-C",
  "artifacts",
  "agent-fm",
]);
const sum = createHash("sha256")
  .update(readFileSync("artifacts/agent-fm-0.1.0.tar.gz"))
  .digest("hex");
await writeFile("artifacts/SHA256SUMS", `${sum}  agent-fm-0.1.0.tar.gz\n`);
console.log("Packaged prebuilt runtime, web and Skill.");
