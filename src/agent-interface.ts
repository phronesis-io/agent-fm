import { activitySummary } from "./activity.ts";
import type { Store } from "./store.ts";
import { findProgram } from "./programs.ts";
import { enqueue } from "./domain.ts";
export const commands = {
  "program list": {risk:"read",input:{},description:"List prepared programs and the queued next program."},
  "program select": {risk:"write",input:{id:"prepared program ID"},description:"Queue for the next Pomodoro without interrupting playback."},
  "program validate": {risk:"read",input:{stdin:"JSON draft: id,title,originalTitle,language,tags,facts:[{text,source}],note,media:{kind:youtube,url} or {kind:edition,edition}"},description:"Check structure and media references. Does not certify factual truth."},
  "program prepare": {risk:"write",input:{stdin:"Same JSON draft as program validate"},description:"Save a candidate. Identical ID and content is an idempotent retry."},
  "context read": {risk:"read", input:{}, description:"Current FM session and bounded activity. No other apps or conversations."},
  "events read": {risk:"read", input:{after:"optional event ID",limit:"1–200, default 50"}, description:"Read the next page, then continue from cursor."},
  "invitation create": {risk:"write", input:{id:"stable request ID, 8–80 letters/digits/hyphens",text:"1–12000 characters"}, description:"Ask the bound Codex. Retry with identical ID and text."},
  "invitation get": {risk:"read", input:{id:"request ID"}, description:"Read reply and durable status. Uncertain requests are not automatically replayed."},
  "companion status": {risk:"read",input:{},description:"Inspect the existing bound Codex session."},
  "language get": {risk:"read",input:{},description:"Read confirmed conversation language."},
  "language set": {risk:"write",input:{language:"BCP 47 tag"},description:"Set the user's confirmed conversation language."},
};
export function capabilities() {
 return {version:1,commands,host:"codex",externalReply:false,externalBinding:false};
}
export function agentRequest(store:Store, input: Record<string,unknown>) {
 const s=store.read();
 const live=new Set(s.sessions.filter(x=>!x.deleted).map(x=>x.id));
 switch(input.command) {
  case "context read": {
   const session=s.sessions.findLast(x=>!x.deleted&&!x.ended);
   return {version:1,now:Date.now(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,language:s.settings.language??null,session:session??null,activity:session ? activitySummary(s,session.id) : null,program:session?.programId?findProgram(s,session.programId):null,events:s.events.filter(e=>e.sessionId===session?.id).slice(-30),messages:s.runs.filter(r=>live.has(r.sessionId)&&r.source==="user").slice(-6).map(r=>({id:r.id,text:r.text,reply:r.reply,status:r.status,created:r.created})),scope:"Only this FM space. Source selection does not prove listening."};
  }
  case "events read": {
   const events=s.events.filter(e=>live.has(e.sessionId));
   const limit=input.limit??50;
   if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>200)throw Error("INVALID_LIMIT");
   const index=input.after===undefined?-1:events.findIndex(e=>e.id===input.after);
   if(input.after!==undefined&&index<0)throw Error("CURSOR_EXPIRED: read context again and restart event paging");
   const page=events.slice(index+1,index+1+Number(limit));
   return {version:1,events:page,cursor:page.at(-1)?.id??input.after??null,hasMore:index+1+page.length<events.length};
  }
  case "companion status":
   return {version:1,host:"codex",threadId:s.settings.threadId,connected:s.settings.connected,language:s.settings.language??null};
  case "invitation create": {
   if(typeof input.id!=="string"||!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)||typeof input.text!=="string"||!input.text.trim()||input.text.length>12000)throw Error("INVALID_INVITATION");
   const id=input.id,text=input.text;
   const run=store.update(s=>enqueue(s,id,text));
   return {version:1,id:run.id,status:run.status};
  }
  case "invitation get": {
   const run=s.runs.find(r=>r.id===input.id&&live.has(r.sessionId));
   if(!run)throw Error("INVITATION_NOT_FOUND");
   return {version:1,id:run.id,status:run.status,reply:run.reply,error:run.error};
  }
  default:throw Error("UNKNOWN_COMMAND");
 }
}
