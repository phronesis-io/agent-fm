import { execFile } from "node:child_process";
type Completion = {id:string; kind:string; at:number};
export function completionReminder(initial: Completion[], deliver:()=>void) {
  const seen = new Set(initial.filter(e=>e.kind==="completed").map(e=>e.id));
  return (events: Completion[], now=Date.now()) => {
    for (const event of events) {
      if (event.kind!=="completed" || seen.has(event.id)) continue;
      seen.add(event.id);
      if (now-event.at>=0 && now-event.at<=120000) deliver();
    }
  };
}
export function macReminder(language = "en") {
  if (process.platform!=="darwin") return;
  execFile("/usr/bin/afplay",["/System/Library/Sounds/Glass.aiff"],{timeout:5000},()=>{});
  const message = language.startsWith("zh") ? "这一钟结束了，可以休息一下。" : "This interval is complete. Time for a break.";
  const subtitle = language.startsWith("zh") ? "番茄完成" : "Pomodoro complete";
  execFile("/usr/bin/osascript",["-e",`display notification "${message}" with title "Agent FM" subtitle "${subtitle}"`],{timeout:5000},()=>{});
}
