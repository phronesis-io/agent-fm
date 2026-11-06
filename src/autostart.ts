import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const label = "io.phronesis.agent-fm";
const domain = () => `gui/${process.getuid!()}`;
const plist = join(homedir(), "Library/LaunchAgents", label + ".plist");
const marker = (data: string) => join(data, "autostart.enabled");
const ctl = (...args: string[]) => execFileSync("/bin/launchctl", args, {stdio:"pipe"});
export const enabled = (data: string) => process.platform === "darwin" && existsSync(marker(data));
export function unload() {
  try { ctl("print", domain() + "/" + label); } catch { return; }
  ctl("bootout", domain() + "/" + label);
}
export function launch() {
  try { ctl("print", domain() + "/" + label); }
  catch { ctl("bootstrap", domain(), plist); }
  ctl("kickstart", domain() + "/" + label);
}
export function configure(data: string, launcher: string) {
  if (process.platform !== "darwin") throw Error("自动启动目前支持 macOS");
  mkdirSync(join(homedir(),"Library/LaunchAgents"),{recursive:true});
  const node = runtimeNode();
  const xml = (s: string) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const args = [node, launcher, "serve"].map(s=>"<string>"+xml(s)+"</string>").join("");
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args}</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>15</integer>
<key>EnvironmentVariables</key><dict><key>AGENT_FM_DATA_DIR</key><string>${xml(data)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>StandardOutPath</key><string>${xml(join(data,"launchd.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(data,"launchd.log"))}</string>
</dict></plist>`,{mode:0o600});
  writeFileSync(marker(data),"enabled\n",{mode:0o600});
}
export function disable(data: string) {
  if (!enabled(data)) return;
  unload();
  unlinkSync(plist);
  unlinkSync(marker(data));
}

export function runtimeNode() {
  return ["/opt/homebrew/opt/node/bin/node", "/usr/local/opt/node/bin/node"]
    .find(path => existsSync(path) && execFileSync(path, ["--version"], {encoding:"utf8"}).trim() === process.version) || process.execPath;
}
