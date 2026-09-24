/* slot-4 gateRepair insert fragment.
 *
 * This file is NOT a standalone module. qa/gate-repair-anchor.mjs reads it and splices
 * the two sections below into the beta.84 plugin/extensions/omo-task.js body:
 *
 *   1. "@insert-block"  -> inserted inside the plan-touch tracker's input handler,
 *                          immediately after the anchor line `let a=i.text,s=nY(r);`
 *                          and before the /skill: branch (same position as the
 *                          recorded st_01a0887d repair).
 *
 *   2. "@append-defs"   -> appended at the end of the bundle (imports are hoisted;
 *                          the declarations are self-contained and use only
 *                          ogR*-aliased node:fs/node:path builtins plus the two
 *                          literal patterns copied from the beta.84 bundle itself:
 *                          omoGateRepairUltraworkBlocks / omoGateRepairSkillBlocks,
 *                          which are byte-equal to that bundle's own strip arrays).
 *
 * beta.84 re-author (P3, st_01a0cb41): the tracker factory renamed mK->eY, the text/session
 * locals swapped (text is now `a`, the session id `s`), and the session-id extractor renamed
 * hK->nY. The adopted-plan touch no longer writes the shadowed handler-local `i` (the beta.81
 * splice's `i+=1` hit the parsed-input object, not the tracker's touch counter): the re-authored
 * block derives the next per-session sequence as max(numeric lastTouchedAt in the session's
 * touch map)+1, which is the same monotonic sequence space the tracker's tool_result handler
 * writes, without reaching for a variable upstream shadows.
 *
 *   - semantics: C:/Users/USER/tmp/piomo-plan-gate-st01a0887d
 *     (oh-my-opencode v5.0.0-beta.51 working tree, HEAD ef1fcc12a2c9c9e6678a7e612685d5dfdb7101c6)
 *     `git diff` of packages/omo-senpi/src/components/task/skill-invocation-tracker.ts
 *     plus the untracked requested-plan-adoption.ts it calls (hash 4220f9de...);
 *   - built reference: the same tree's packages/omo-senpi/plugin/extensions/omo-task.js
 *     (sha256 f9ea72d4..., the "built/installed" half of the st_01a0887d receipt);
 *   - beta.51 upstream half: 49aee3a4... (test-hosts/omo-beta51-clean);
 *   - beta.84 anchor map: the slot-4 seam (tracker eY, T3a seam map) plus the
 *     body-digest banner scheme from packages/omo-senpi/plugin/scripts/build-artifact.mjs.
 *
 * Known deviations from the recorded repair, recorded deliberately:
 *   - `omoGateRepairPi.appendEntry?.` stays inert on beta.84 for the same reason it was inert on
 *     beta.81: that bundle's pi surface has no appendEntry (0 occurrences) and the task manager's
 *     appendEvent has a different signature (tasks.appendEvent(taskId, event)). Journal emission
 *     for "omo.plan-review-adoption" therefore stays a no-op until Todo 6/11 map it.
 *   - the banner's sourceDigest half is kept (a beta.81 source build is not available
 *     offline); the bodyDigest half is refreshed from the patched body.
 *
 * Todo 6 rework (task-6b, closes the two engine-boundary gaps from task-11-gateproof-engine-boundary.json):
 *   - gap 1 (in-process children emit no extension events): the A1 recorder now ALSO observes the
 *     task engine's own child stream - engine.onStoreMutation fires when the child record is saved
 *     (before the child runs), manager.subscribeChild(taskId, listener) taps the live child handle's
 *     raw engine events, and plan touches are extracted from the child's tool_execution_start/end
 *     pair with the same read/write/edit/apply_patch rule and isError filter the extension recorder
 *     uses. The touch lands under the child's session id in the caller's per-session touch map and is
 *     flushed to the session-owned ledger. process-mode children are skipped: their own engine
 *     process loads the argv extensions and writes the same ledger itself.
 *   - gap 2 (process-mode records lack child_session_id): omoA1Descendants resolves the missing edge
 *     from the engine's own child session directory (children/<taskId>/sessions/<taskId>/<ts>_<sessionId>.jsonl)
 *     before the fixpoint, so a written descendant ledger becomes reachable.
 */
// ==== @insert-block
{const omoGRInput=omoGateRepairInput(omoA1State,s,e);if(omoGRInput)return omoGRInput;}
{const omoGRStripped=omoGateRepairStrip(a),omoGRUnquoted=omoGateRepairStripQuotedRegions(a).replace(/(["'])[^"'\r\n]*<skill\s+name="[^"]+"[\s\S]*?<\/skill>[^"'\r\n]*\1/g,omoGateRepairMask),omoGRVisible=omoGateRepairVisible(omoGateRepairStrip(omoGRUnquoted)),omoGRSkills=omoGateRepairSkillNames(omoGRUnquoted),omoGRExplicit=omoGateRepairIsReviewRequest(omoGRVisible)||omoGateRepairIsNoHyphenRequest(omoGRVisible)||a.startsWith("/skill:ulw-plan ")||omoGRSkills.includes("ulw-plan");for(const omoGRSkill of omoGRSkills)o(t,s,omoGRSkill),o(n,s,omoGRSkill);a=omoGateRepairVisible(omoGRUnquoted).replace(/\bulwplan\b/gi,omoGateRepairMask);if(omoGRExplicit&&void 0!==s&&(o(n,s,"ulw-plan"),!t.get(s)?.has("ulw-execute"))){const omoGRAdoption=omoGateRepairAdoptRequestedPlan(omoGRStripped,omoGateRepairPi.cwd??process.cwd());omoGateRepairPi.appendEntry?.("omo.plan-review-adoption",{sessionId:s,...omoGRAdoption});if("adopted"===omoGRAdoption.kind){const omoGRTouches=r.get(s)??new Map(),omoGRPrior=omoGRTouches.get(omoGRAdoption.path);let omoGRSeq=0;for(const omoGRItem of omoGRTouches.values()){const omoGRValue=omoGRItem?.lastTouchedAt;"number"==typeof omoGRValue&&omoGRValue>omoGRSeq&&(omoGRSeq=omoGRValue)}omoGRSeq+=1,omoGRTouches.set(omoGRAdoption.path,{count:(omoGRPrior?.count??0)+1,lastTouchedAt:omoGRSeq}),r.set(s,omoGRTouches)}}}
// ==== @append-defs
import{realpathSync as ogRRealpathSync,lstatSync as ogRLstatSync,openSync as ogROpenSync,fstatSync as ogRFstatSync,readFileSync as ogRReadFileSync,closeSync as ogRCloseSync,mkdirSync as ogRMkdirSync,writeFileSync as ogRWriteFileSync,renameSync as ogRRenameSync,rmSync as ogRRmSync,readdirSync as ogRReaddirSync,linkSync as ogRLinkSync,fsyncSync as ogRFsyncSync}from"node:fs";
import{join as ogRJoin,basename as ogRBasename,isAbsolute as ogRIsAbsolute,resolve as ogRResolve,dirname as ogRDirname}from"node:path";
import{createHash as ogRCreateHash,randomUUID as ogRRandomUUID}from"node:crypto";
var omoGateRepairSkillName=/<skill\s+name="([^"]+)"/gi;
var omoGateRepairUltraworkBlocks=[/<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/gi,/<system-reminder>[\s\S]*?<\/system-reminder>/gi];
var omoGateRepairSkillBlocks=[/<skill\s+name="[^"]*"[\s\S]*?<\/skill>/gi,/<skill\s+name="[^"]*"[\s\S]*$/i];
var omoGateRepairInjectedBlock=/<(omo-[a-z0-9-]+-pointer|ultrawork-mode|omo-ultrawork-reminder)>[\s\S]*?<\/\1>/gi;
var omoGateRepairInlineCode=/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
function omoGateRepairMask(region){return region.replace(/[^\r\n]/g,"\u0000")}
function omoGateRepairStripQuotedRegions(text){let visible=text.replace(omoGateRepairInjectedBlock,omoGateRepairMask);const fenceStart=/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;for(;;){const opening=fenceStart.exec(visible);if(opening===null)break;const fence=opening[1];const fenceEnd=new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`,"gm");fenceEnd.lastIndex=fenceStart.lastIndex;const closing=fenceEnd.exec(visible);const end=closing===null?visible.length:fenceEnd.lastIndex;visible=visible.slice(0,opening.index)+omoGateRepairMask(visible.slice(opening.index,end))+visible.slice(end);fenceStart.lastIndex=end}return visible.replace(omoGateRepairInlineCode,omoGateRepairMask)}
function omoGateRepairIsReviewRequest(text){const visible=omoGateRepairStripQuotedRegions(text);return /(?:^|[\n.!?]\s*)(?:please\s+)?(?:review|resume|continue|complete)\s+(?:(?:the|this|an?)\s+)?(?:existing\s+)?plan\b/i.test(visible)||/계획(?:서)?\s*(?:리뷰|검토)(?:까지|를|을)?\s*(?:(?:진행|완료)\s*)?(?:해줘|해주세요|하자)/.test(visible)}
function omoGateRepairSkillNames(text){const names=[];for(const match of text.matchAll(omoGateRepairSkillName)){const name=match[1]?.trim();if(name!==undefined&&name.length>0)names.push(name)}return[...new Set(names)]}
function omoGateRepairStrip(text){let out=text;for(const pattern of omoGateRepairUltraworkBlocks)out=out.replace(pattern,"");for(const pattern of omoGateRepairSkillBlocks)out=out.replace(pattern,"");return out}
function omoGateRepairVisible(text){return omoGateRepairStripQuotedRegions(text).replace(/"[^"\n]*"|'[^'\n]*'/g,omoGateRepairMask)}
function omoGateRepairIsNoHyphenRequest(text){const visible=omoGateRepairVisible(text).trim();return /(?:^|[\s.!?])mass\s+ulwplan\s*[.!]?$|^(?:오키|오케|좋아)\s+(?:제대로\s+)?ulwplan\s+(?:잡자|짜자|세우자|해줘|진행하자)\s*[.!]?$/i.test(visible)}
var omoGateRepairRequestedPath=/(?:^|[\s"'`(])((?:[A-Za-z]:[\\/]|\/)[^"'`\r\n]*?\.omo[\\/]plans[\\/][A-Za-z0-9][A-Za-z0-9._-]*\.md|\.omo[\\/]plans[\\/][A-Za-z0-9][A-Za-z0-9._-]*\.md)(?=$|[\s"'`),;]|\.(?:\s|$)|(?:와|과|을|를|에|의)(?=\s|$))/g;
function omoGateRepairAdoptRequestedPlan(text,cwd){const cleaned=text.replace(/^\/skill:[^\s]+\s+/,"");const paths=[...new Set([...cleaned.matchAll(omoGateRepairRequestedPath)].map(match=>match[1]))];const requested=paths[0];if(paths.length!==1||requested===undefined)return{kind:"rejected",reason:"exact-plan-path-required"};const normalized=requested.replace(/\\/g,"/");try{const root=ogRRealpathSync(cwd);const path=ogRJoin(root,".omo","plans",ogRBasename(normalized));const absolute=ogRIsAbsolute(normalized)?normalized:`${root.replace(/\\/g,"/")}/${normalized}`;if(absolute!==path.replace(/\\/g,"/")||ogRResolve(absolute)!==path)return{kind:"rejected",reason:"noncanonical-or-foreign-plan"};for(const directory of[ogRJoin(root,".omo"),ogRJoin(root,".omo","plans")]){const stat=ogRLstatSync(directory);if(stat.isSymbolicLink()||!stat.isDirectory())return{kind:"rejected",reason:"aliased-plan-directory"}}const before=ogRLstatSync(path);if(before.isSymbolicLink()||!before.isFile()||ogRRealpathSync(path)!==path)return{kind:"rejected",reason:"noncanonical-plan-file"};const descriptor=ogROpenSync(path,"r");try{const opened=ogRFstatSync(descriptor);if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)return{kind:"rejected",reason:"plan-identity-changed"};ogRReadFileSync(descriptor);if(ogRRealpathSync(path)!==path||ogRLstatSync(path).ino!==opened.ino)return{kind:"rejected",reason:"plan-identity-changed"};return{kind:"adopted",path:path.replace(/\\/g,"/")}}finally{ogRCloseSync(descriptor)}}catch(error){if(error instanceof Error&&"code"in error&&typeof error.code==="string")return{kind:"rejected",reason:`plan-read-${error.code}`};throw error}}
// A genuine user request and the execute prohibition survive tracker recreation in a
// session-owned ledger. Shutdown may be part of reload, so it must not delete this file.
var omoGateRepairRequestTtlMs=2592000000;
function omoGateRepairFile(state,session){return ogRJoin(state.stateDir,"plan-requests",omoA1SafeSessionId(session)+".json")}
function omoGateRepairExecuteFile(state,session){return ogRJoin(state.stateDir,"plan-executions",omoA1SafeSessionId(session)+".json")}
function omoGateRepairWasExecuted(state,session){if("string"!=typeof session||!session.length)return!1;try{ogRReadFileSync(omoGateRepairExecuteFile(state,session));return!0}catch(error){if(error?.code==="ENOENT")return!1;return!0}}
function omoGateRepairMarkExecuted(state,session){if("string"!=typeof session||!session.length)return;const file=omoGateRepairExecuteFile(state,session);ogRMkdirSync(ogRDirname(file),{recursive:!0});let descriptor;try{descriptor=ogROpenSync(file,"wx");ogRWriteFileSync(descriptor,JSON.stringify({sessionId:session,projectKey:state.projectKey,skill:"ulw-execute"})+"\n","utf8")}catch(error){if(error?.code!=="EEXIST")throw error}finally{if(descriptor!==undefined)ogRCloseSync(descriptor)}}
function omoGateRepairRead(state,session){try{if("string"!=typeof session||!session.length)return;const value=JSON.parse(ogRReadFileSync(omoGateRepairFile(state,session),"utf8"));const now=Date.now();if(value?.sessionId!==session||value.projectKey!==state.projectKey||value.skill!=="ulw-plan"||!Number.isSafeInteger(value.recordedAtMs)||value.recordedAtMs>now||now-value.recordedAtMs>omoGateRepairRequestTtlMs||!(value.requestAtMs===null||Number.isSafeInteger(value.requestAtMs)&&value.requestAtMs>=value.recordedAtMs&&value.requestAtMs<=now)||"boolean"!=typeof value.executed)return;return value}catch{return}}
function omoGateRepairSave(state,session,requested,executed,reentry){requested=!!reentry&&requested;if("string"!=typeof session||!session.length)return;executed=omoGateRepairEpochRead(state,session).epoch>0;if(!requested&&!executed)return;const old=omoGateRepairRead(state,session),now=Date.now(),file=omoGateRepairFile(state,session);const value={sessionId:session,projectKey:state.projectKey,skill:"ulw-plan",recordedAtMs:reentry?now:old?.recordedAtMs??now,requestAtMs:reentry?now:old?.requestAtMs??(requested?now:null),executed,epoch:reentry?.epoch??old?.epoch,reentryId:reentry?.ack??old?.reentryId};const tmp=file+"."+ogRRandomUUID()+".tmp";try{ogRMkdirSync(ogRDirname(file),{recursive:!0});ogRWriteFileSync(tmp,JSON.stringify(value)+"\n","utf8");ogRRenameSync(tmp,file);return!0}finally{ogRRmSync(tmp,{force:!0})}}
// Policy A ordering is an append-only session/project journal, not wall-clock order.
// A flushed temporary file is hard-linked to the next ordinal (atomic create, never replace).
// Competing writers re-read after EEXIST; input captures its FIRST observed epoch, so a
// stale writer cannot rebase an old command onto a newer execution. No locks, sleeps, or
// stale-lock recovery. Unpublished execute staging is durable DENY evidence, never an ack.
// Keep it after non-EEXIST failure; ordinary staging and collision losers are cleaned up.
// The staged tool_effect_before hook reserves synchronously AFTER all tool_call vetoes,
// immediately before definition.execute. A throw prevents the effect, with no settled event.
// Only tool_effect_settled's actual promise outcome advances/releases the reservation;
// ordinary tool_result can be mutated or synthesized on abort and owns neither operation.
// A vetoed/skipped call creates no reservation. A genuinely pending invocation stays DENY
// until actual settlement, including across owner reentry, abort, and tracker/process reload.
// Input failures return handled before expansion. Request-file executed is derived from the
// durable epoch, never the native input tracker's unadmitted/sticky invocation set.
// The journal and historical marker must survive reload. Never prune input/read identities:
// a duplicate callback must remain a duplicate after a later execute or another process.
// Engine bridge contract: originalText is immutable owner text (not transformed text/XML);
// inputId identifies one input across its callbacks and is not reused across engine lifetimes.
// The new engine identity contract is implemented separately by the engine integration lane.
// interactive/rpc are owner paths; the upstream seam excludes extension input. Only queued
// and started dispositions admit reentry. Missing originalText cannot acknowledge an epoch.
// toolCallId identifies the paired effect events, independently of prompt inputId. This
// source requires the staged effect bridge; there is no ordinary tool_result fallback.
// The state filesystem must support atomic hard-link create.
// Survive extension generation reloads inside this process, but not process replacement.
var omoGateRepairFailedExecute=globalThis[Symbol.for("omo.gateRepair.failedExecute")]??=new Set;
function omoGateRepairFailureKey(state,session){return state.projectKey+":"+session}
function omoGateRepairEpochDir(state,session){return ogRJoin(state.stateDir,"plan-epochs",omoA1SafeSessionId(session))}
function omoGateRepairReduce(view,event){
  if(event.kind==="execute"){
    if(!view.reads.has(event.id)){view.reads.add(event.id);view.epoch+=1;view.ack=null}
    if(view.readReservations.has(event.id))view.readReservations.set(event.id,"succeeded");
  }else if(event.kind==="reserve-read"){
    if(!view.readReservations.has(event.id)&&!view.reads.has(event.id))view.readReservations.set(event.id,"pending");
  }else if(event.kind==="release-read"){
    if(view.readReservations.get(event.id)==="pending")view.readReservations.set(event.id,"failed");
  }else if(event.kind==="input"){
    if(!view.inputs.has(event.id))view.inputs.set(event.id,{skill:event.skill,epoch:event.epoch,reentry:event.reentry!==!1,settled:!1});
  }else{
    const input=view.inputs.get(event.id);
    if(input&&!input.settled){input.settled=!0;if(event.admitted){
      if(input.skill==="ulw-execute"){view.epoch+=1;view.ack=null}
      else if(input.epoch===view.epoch&&(view.epoch===0||input.reentry))view.ack=event.id;
    }}
  }
  view.revision=event.revision;
  return view;
}
function omoGateRepairEpochRead(state,session){
  const view={revision:0,baseEpoch:omoGateRepairWasExecuted(state,session)?1:0,epoch:0,ack:null,inputs:new Map,reads:new Set,readReservations:new Map};
  view.epoch=view.baseEpoch;
  for(;;){
    let text;
    try{text=ogRReadFileSync(ogRJoin(omoGateRepairEpochDir(state,session),(view.revision+1)+".json"),"utf8")}
    catch(error){if(error?.code==="ENOENT")return view;throw error}
    const event=JSON.parse(text);
    if(event?.sessionId!==session||event.projectKey!==state.projectKey||event.revision!==view.revision+1||
      ![0,1].includes(event.baseEpoch)||typeof event.id!=="string"||!event.id.length||
      !["execute","input","disposition","reserve-read","release-read"].includes(event.kind)||
      event.kind==="input"&&(!["ulw-plan","ulw-execute"].includes(event.skill)||!Number.isSafeInteger(event.epoch)||event.epoch<0||event.reentry!==undefined&&typeof event.reentry!=="boolean")||
      event.kind==="disposition"&&typeof event.admitted!=="boolean")throw new Error("GATE_REPAIR_EPOCH_CORRUPT");
    if(view.revision===0)view.epoch=view.baseEpoch=event.baseEpoch;
    else if(event.baseEpoch!==view.baseEpoch)throw new Error("GATE_REPAIR_EPOCH_FOREIGN_BASE");
    omoGateRepairReduce(view,event);
  }
}
function omoGateRepairEpochAppend(state,session,makeEvent){
  for(let attempt=0;attempt<32;attempt+=1){
    const view=omoGateRepairEpochRead(state,session),change=makeEvent(view);
    if(!change)return view;
    const event={...change,sessionId:session,projectKey:state.projectKey,baseEpoch:view.baseEpoch,revision:view.revision+1};
    const closing=event.kind==="execute"||event.kind==="input"&&event.skill==="ulw-execute"||event.kind==="disposition"&&view.inputs.get(event.id)?.skill==="ulw-execute";
    const dir=omoGateRepairEpochDir(state,session),tmp=ogRJoin(dir,ogRRandomUUID()+(closing?".execute.tmp":".tmp"));
    let cleanup=!0;
    ogRMkdirSync(dir,{recursive:!0});
    try{
      const fd=ogROpenSync(tmp,"wx");
      try{ogRWriteFileSync(fd,JSON.stringify(event)+"\n","utf8");ogRFsyncSync(fd)}finally{ogRCloseSync(fd)}
      try{ogRLinkSync(tmp,ogRJoin(dir,event.revision+".json"))}
      catch(error){if(error?.code==="EEXIST")continue;throw error}
      return omoGateRepairReduce(view,event);
    }catch(error){cleanup=!closing;throw error}
    finally{if(cleanup)ogRRmSync(tmp,{force:!0})}
  }
  throw new Error("GATE_REPAIR_EPOCH_CONTENTION");
}
function omoGateRepairExecute(state,session,id){
  if(typeof session!=="string"||!session.length)return;
  const identity=typeof id==="string"&&id.length?id:ogRRandomUUID();
  let reserved=!1;
  try{
    omoGateRepairEpochAppend(state,session,view=>{
      reserved=view.readReservations.get(identity)==="pending";
      return view.reads.has(identity)?undefined:{kind:"execute",id:identity};
    });
    omoGateRepairMarkExecuted(state,session);
  }catch(error){if(!reserved)omoGateRepairFailedExecute.add(omoGateRepairFailureKey(state,session));throw error}
}
function omoGateRepairEffectBefore(state,session,event){
  // This synchronous, non-swallowed hook is inside the final definition wrapper.
  if(event.toolName!=="read"||typeof event.input?.path!=="string"||GV.exec(event.input.path)?.[1]!=="ulw-execute")return;
  if(typeof session!=="string"||!session.length||typeof event.toolCallId!=="string"||!event.toolCallId.length)
    throw new Error("GATE_REPAIR_EXECUTE_READ_IDENTITY_REQUIRED");
  let fresh=!1;
  const view=omoGateRepairEpochAppend(state,session,current=>{
    fresh=!1;
    if(current.readReservations.has(event.toolCallId)||current.reads.has(event.toolCallId))return;
    fresh=!0;return{kind:"reserve-read",id:event.toolCallId};
  });
  if(!fresh||view.readReservations.get(event.toolCallId)!=="pending")throw new Error("GATE_REPAIR_EXECUTE_READ_IDENTITY_REUSED");
}
function omoGateRepairEffectSettled(state,session,event){
  if(event.toolName!=="read"||GV.exec(event.input?.path)?.[1]!=="ulw-execute"||typeof session!=="string"||!session.length||typeof event.toolCallId!=="string")return;
  if(omoGateRepairEpochRead(state,session).readReservations.get(event.toolCallId)!=="pending")return;
  if(event.ok===!0&&event.isError!==!0)omoGateRepairExecute(state,session,event.toolCallId);
  else if(event.ok===!1||event.ok===!0&&event.isError===!0)
    omoGateRepairEpochAppend(state,session,view=>view.readReservations.get(event.toolCallId)==="pending"?{kind:"release-read",id:event.toolCallId}:undefined);
}
function omoGateRepairListen(pi,state){
  pi.on("tool_effect_before",(event,ctx)=>omoGateRepairEffectBefore(state,nY(ctx),event));
  pi.on("tool_effect_settled",(event,ctx)=>omoGateRepairEffectSettled(state,nY(ctx),event));
}
// Native skill-invocation token grammar: leading slash/dollar runs, then inline dollar
// skills, capped at 64 tokens. Native dollar expansion is NOT quote/fence-aware.
// Quote masking applies only to the owner-approved bare narrative form, not native tokens.
function omoGateRepairIsExecuteRequest(text){
  const visible=text;
  if(/^\s*\/ulw-execute(?=\s|$)/.test(omoGateRepairVisible(text)))return!0;
  let cursor=0,count=0;
  while(cursor<visible.length&&count<64){
    const whitespace=/^\s*/.exec(visible.slice(cursor))[0];cursor+=whitespace.length;
    const match=/^(?:\/skill:([a-zA-Z][a-zA-Z0-9:_-]*)|\$([a-zA-Z][a-zA-Z0-9:_-]*))(?=\s|$)/.exec(visible.slice(cursor));
    if(!match)break;
    const name=match[1]??match[2].replace(/^skill:/,"");
    if(name==="ulw-execute")return!0;
    count+=1;cursor+=match[0].length;
  }
  for(const match of visible.slice(cursor).matchAll(/(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g)){
    if(count>=64)break;
    const name=match[2].replace(/^skill:/,"");
    if(name==="ulw-execute")return!0;
    if(match[2].startsWith("skill:")||name==="ulw-plan")count+=1;
  }
  return!1;
}
function omoGateRepairIsOwnerPlanRequest(text){
  const unquoted=omoGateRepairStripQuotedRegions(text).replace(/(["'])[^"'\r\n]*<skill\s+name="[^"]+"[\s\S]*?<\/skill>[^"'\r\n]*\1/g,omoGateRepairMask);
  const visible=omoGateRepairVisible(omoGateRepairStrip(unquoted));
  return /^\/skill:ulw-plan(?: |$)/.test(text)||omoGateRepairSkillNames(unquoted).includes("ulw-plan")||
    omoGateRepairIsReviewRequest(visible)||omoGateRepairIsNoHyphenRequest(visible)||
    YV["ulw-plan"].test(visible.replace(/\bulwplan\b/gi,omoGateRepairMask))||QV.some(pattern=>pattern.test(visible));
}
function omoGateRepairInput(state,session,event){
  if(typeof session!=="string"||!session.length)return;
  const owner=event.source==="interactive"||event.source==="rpc";
  const original=event.originalText;
  const skill=owner&&typeof original==="string"?(omoGateRepairIsExecuteRequest(original)?"ulw-execute":omoGateRepairIsOwnerPlanRequest(original)?"ulw-plan":undefined):undefined;
  if(skill&&typeof event.inputId==="string"&&event.inputId.length){
    try{
      const epoch=omoGateRepairEpochRead(state,session).epoch;
      omoGateRepairEpochAppend(state,session,view=>view.inputs.has(event.inputId)?undefined:{kind:"input",id:event.inputId,skill,epoch,reentry:original==="/skill:ulw-plan"});
    }catch(error){
      // The installed input runner catches throws and continues. A handled result is the veto.
      if(skill==="ulw-execute")omoGateRepairFailedExecute.add(omoGateRepairFailureKey(state,session));
      console.error("GATE_REPAIR_INPUT_NOT_ADMITTED",error);
      return{action:"handled"};
    }
  }
}
function omoGateRepairDisposition(state,session,event){
  if(typeof session!=="string"||!session.length||typeof event.inputId!=="string")return;
  const admitted=event.disposition==="started"||event.disposition==="queued";
  if(!admitted&&event.disposition!=="handled"&&event.disposition!=="rejected")return;
  let fresh=!1;
  const view=omoGateRepairEpochAppend(state,session,current=>{
    fresh=!1;
    const input=current.inputs.get(event.inputId);
    if(!input||input.settled)return;
    fresh=!0;return{kind:"disposition",id:event.inputId,admitted};
  });
  if(!fresh||!admitted)return;
  const input=view.inputs.get(event.inputId);
  if(input.skill==="ulw-execute"){
    omoGateRepairMarkExecuted(state,session);
    omoGateRepairSave(state,session,!1,!0);
  }else if(view.ack===event.inputId)omoGateRepairSave(state,session,!0,view.epoch>0,view);
}
function omoGateRepairExecuteBlocked(state,session){
  try{
    if(omoGateRepairFailedExecute.has(omoGateRepairFailureKey(state,session)))return!0;
    const epoch=omoGateRepairEpochRead(state,session),request=omoGateRepairRead(state,session);
    try{
      const dir=omoGateRepairEpochDir(state,session);
      for(const name of ogRReaddirSync(dir))if(name.endsWith(".execute.tmp")){
        let staged;
        try{staged=JSON.parse(ogRReadFileSync(ogRJoin(dir,name),"utf8"))}catch(error){if(error?.code==="ENOENT")continue;throw error}
        // A replayed successful result can reconcile its own earlier failed publication.
        if(staged.sessionId!==session||staged.projectKey!==state.projectKey||staged.kind!=="execute"||!epoch.reads.has(staged.id))return!0;
      }
    }catch(error){if(error?.code!=="ENOENT")throw error}
    for(const status of epoch.readReservations.values())if(status==="pending")return!0;
    for(const input of epoch.inputs.values())if(input.skill==="ulw-execute"&&!input.settled)return!0;
    if(epoch.epoch===0)return request?.executed===!0;
    return !request?.requestAtMs||request.epoch!==epoch.epoch||request.reentryId!==epoch.ack||epoch.ack===null;
  }catch{return!0}
}
// ==== A1 plan-touch ledger (Todo 6; ledger schema v1, session-owned, descendant-union read).
// File contract: <stateDir>/plan-touches/<safe-sessionId>.json = {sessionId,projectKey,revision,entries:[{path,count,touchedAtMs,sequence}]}.
// The ledger is NEW state (the engine exposes no persistence seam for plan touches) and survives
// session_shutdown because shutdown deletes the in-memory maps only. Hygiene: 64 paths per session,
// 30-day TTL, whole-file tmp+rename writes, per-session serialization, malformed/foreign files ignored.
// The artifact view for a session is the union of its own touches and its descendant sessions'
// touches (transitive parent->child over manager records; shared-root siblings are never admitted),
// each session taken as ONE whole snapshot - memory wins while the session lives in this process,
// the ledger is the surviving mirror for dead sessions - and counts are never summed across memory
// and mirror. Cross-session ordering uses the wall clock (touchedAtMs); the recorder-local sequence
// counter only breaks ties inside one session/process. Resolver parsing (jg/Ug/Fg) is untouched, so
// a space inside a plan filename keeps its recorded fallback behaviour (known limitation, Todo 11).
// Todo 6 rework: child touches are captured from the engine's own child stream (gap 1) and
// process-mode records recover their child session ids from the engine's child session directory
// (gap 2); see omoA1WatchEvent / omoA1TaskSessionIds below.
var omoA1MaxPaths=64,omoA1TtlMs=2592000000;
var omoA1PlanPathShape=/(^|[\\/])\.omo[\\/]plans[\\/][^\\/]+\.md$/i;
var omoA1PlanPatchShape=new RegExp(/\.omo[\\/]plans[\\/][^\s"'`]+\.md/i.source,"gi");
var omoA1ChildToolNames=new Set(["read","write","edit"]);
var omoA1TerminalStatuses=new Set(["completed","error","failed","cancelled","canceled","interrupted","lost"]);
function omoA1StateDir(e){try{const t=e?.stateDir;if("string"==typeof t&&t.length>0)return t;const n=e?.engine?.settings?.state_dir;if("string"==typeof n&&n.length>0)return n;const r=e?.engine?.runtime?.cwd?.();if("string"==typeof r&&r.length>0)return ogRJoin(r,".omo","senpi-task")}catch{}return ogRJoin(process.cwd(),".omo","senpi-task")}
function omoA1SafeSessionId(e){const t="string"==typeof e?e.replace(/[^A-Za-z0-9._-]/g,"_").slice(0,120):"";return t.length>0&&"."!==t&&".."!==t?t:"unknown"}
function omoA1ProjectKey(e){try{return ogRCreateHash("sha256").update(e.replace(/\\/g,"/").toLowerCase()).digest("hex").slice(0,16)}catch{return"unknown"}}
function omoA1LedgerFile(e,t){return ogRJoin(e,"plan-touches",omoA1SafeSessionId(t)+".json")}
function omoA1Hygiene(e,t){const n=[];for(const r of e){if(r.touchedAtMs>0&&r.touchedAtMs<t-omoA1TtlMs)continue;n.push(r)}n.sort((e,t)=>t.touchedAtMs-e.touchedAtMs||t.sequence-e.sequence||t.count-e.count);return n.length>omoA1MaxPaths?n.slice(0,omoA1MaxPaths):n}
function omoA1ReadLedger(e,t,n){try{const r=JSON.parse(ogRReadFileSync(omoA1LedgerFile(e,t),"utf8"));if(null===r||"object"!=typeof r||Array.isArray(r))return;if(r.sessionId!==t||r.projectKey!==omoA1ProjectKey(e))return;if("number"!=typeof r.revision||!Array.isArray(r.entries))return;const i=[];for(const o of r.entries){if(null===o||"object"!=typeof o)continue;const s=o.path;if("string"!=typeof s||0===s.length)continue;if("number"!=typeof o.count||!(o.count>0))continue;i.push({path:s,count:Math.floor(o.count),touchedAtMs:"number"==typeof o.touchedAtMs&&o.touchedAtMs>0?o.touchedAtMs:0,sequence:"number"==typeof o.sequence&&o.sequence>0?o.sequence:0})}return{revision:r.revision,entries:omoA1Hygiene(i,n)}}catch{return}}
function omoA1MemorySnapshot(e,t,n,r){const i=n.get(t);if(void 0===i||0===i.size)return;let o=e.stamps.get(t),s=0;for(const e of i.values()){const t="number"==typeof e?.lastTouchedAt?e.lastTouchedAt:0;t>s&&(s=t)}if(void 0===o||s>o.sequence)o={sequence:s,at:r},e.stamps.set(t,o);const a=[];for(const[e,t]of i.entries())a.push({path:e,count:"number"==typeof t?.count&&t.count>0?Math.floor(t.count):1,touchedAtMs:o.at,sequence:"number"==typeof t?.lastTouchedAt&&t.lastTouchedAt>0?t.lastTouchedAt:0});return omoA1Hygiene(a,r)}
function omoA1SessionView(e,t,n,r){const i=omoA1MemorySnapshot(e,t,n,r);if(void 0!==i&&i.length>0)return{source:"memory",entries:i};const o=omoA1ReadLedger(e.stateDir,t,r);return void 0===o?{source:"none",entries:[]}:{source:"ledger",entries:o.entries}}
// Gap 2: process-mode task records carry parent_session_id but never child_session_id (the child
// session id is born inside the spawned process and is not written back), so the fixpoint found no
// edge. The engine does keep the mapping on disk: <stateDir>/children/<taskId>/sessions/<taskId>/<timestamp>_<sessionId>.jsonl.
// omoA1TaskSessionIds recovers those session ids (newest-last, bounded) and omoA1Descendants adds one
// edge per recovered id. root_session_id stays a consistency check only and never enumerates or
// admits a session on its own: an edge is refused when its recorded root is neither the caller's
// computed tree root (in-process records inherit the process root) nor the edge's own parent
// (process-mode records carry the spawning session as their root, observed live: the orchestrator
// record roots at the lead session and the grandchild writer roots at the orchestrator session).
// Nothing here parses plan paths or admits siblings: it only materializes the engine's own
// task->session edge.
function omoA1TaskSessionIds(e,t){try{if("string"!=typeof t||0===t.length||!/^[A-Za-z0-9._-]+$/.test(t))return[];const n=ogRReaddirSync(ogRJoin(e,"children",t,"sessions",t)),r=[];for(const e of n){if("string"!=typeof e)continue;const t=/^(?:.*_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(e);if(null===t)continue;r.includes(t[1])||r.push(t[1])}r.sort();return r.length>8?r.slice(-8):r}catch{return[]}}
function omoA1Descendants(e,t){const n=[];try{const r=e.manager;if("string"!=typeof t||0===t.length||null===r||void 0===r||"function"!=typeof r.list)return n;const i=r.list({scope:"all"});if(!Array.isArray(i))return n;const o=new Map,s=new Map,a=new Map;for(const r of i){const i=r?.record;if(null===i||void 0===i||"object"!=typeof i)continue;const c="string"==typeof i.parent_session_id?i.parent_session_id:void 0,l="string"==typeof i.child_session_id?i.child_session_id:void 0,d="string"==typeof i.root_session_id?i.root_session_id:void 0;if(void 0===c)continue;const u=void 0!==l?[l]:"string"==typeof i.task_id?omoA1TaskSessionIds(e.stateDir,i.task_id):[];for(const e of u){if("string"!=typeof e||0===e.length||e===c)continue;const t=o.get(c);void 0===t?o.set(c,[e]):t.includes(e)||t.push(e),s.has(e)||s.set(e,c),void 0===d||a.has(e)||a.set(e,d)}}let c=t,l=0;for(;s.has(c)&&l<256;)c=s.get(c),l+=1;const d=new Set([t]),u=[t];for(;u.length>0;){const e=u.shift();for(const t of o.get(e)??[]){if(d.has(t))continue;const r=a.get(t);if(void 0!==r&&r!==c&&r!==e)continue;d.add(t),n.push(t),u.push(t)}}}catch{}return n}
function omoA1MergeViews(e){const t=new Map;for(const n of e)for(const e of n){const n=t.get(e.path);if(void 0===n){t.set(e.path,e);continue}if(e.touchedAtMs>n.touchedAtMs)t.set(e.path,e);else if(e.touchedAtMs===n.touchedAtMs&&(e.count>n.count||e.count===n.count&&e.sequence>n.sequence))t.set(e.path,e)}const n=[...t.values()];n.sort((e,t)=>t.count-e.count||t.touchedAtMs-e.touchedAtMs||t.sequence-e.sequence);return n.map(e=>({path:e.path,count:e.count,lastTouchedAt:e.touchedAtMs>0?e.touchedAtMs:e.sequence}))}
function omoA1Signature(e){return JSON.stringify(e.map(e=>[e.path,e.count,e.sequence]))}
function omoA1CarryStamps(e,t){if(void 0===t)return e;const n=new Map(t.entries.map(e=>[e.path,e]));return e.map(e=>{const t=n.get(e.path);return void 0!==t&&t.sequence===e.sequence&&t.touchedAtMs>0?{...e,touchedAtMs:t.touchedAtMs}:e})}
function omoA1Flush(e,t,n,r){try{if("string"!=typeof t||0===t.length)return!1;if(e.inFlight.has(t))return!1;const i=n.get(t);if(void 0===i||0===i.size)return!1;const o=omoA1MemorySnapshot(e,t,n,r);if(void 0===o||0===o.length)return!1;const s=omoA1Signature(o);if(e.lastWritten.get(t)===s)return!1;e.inFlight.add(t);try{const n=omoA1ReadLedger(e.stateDir,t,r),i=omoA1CarryStamps(o,n),d=(n?.revision??0)+1,a=omoA1LedgerFile(e.stateDir,t);ogRMkdirSync(ogRDirname(a),{recursive:!0});const c=a+"."+process.pid+"."+(e.writes+=1)+".tmp";try{ogRWriteFileSync(c,JSON.stringify({sessionId:t,projectKey:e.projectKey,revision:d,entries:i})+"\n","utf8"),ogRRenameSync(c,a)}catch{try{ogRRmSync(c,{force:!0})}catch{}return!1}return e.lastWritten.set(t,s),e.revisions.set(t,d),!0}finally{e.inFlight.delete(t)}}catch{return!1}}
function omoA1ArtifactEntries(e,t,n){const r=Date.now();try{omoA1Flush(e,t,n,r);const i=[omoA1SessionView(e,t,n,r).entries];for(const o of omoA1Descendants(e,t))i.push(omoA1SessionView(e,o,n,r).entries);return omoA1MergeViews(i)}catch{return omoA1MergeViews([omoA1SessionView(e,t,n,r).entries])}}
// Gap 1: child plan touches from the engine's own child stream. The child session id comes from the
// record (in-process attach), the live handle, or the engine's child session directory. Only
// in-process children are captured here; process-mode children write their own ledger in their own
// engine process, so recording them here as well would race the same file for no gain.
function omoA1ChildRecord(e,t){try{const n=e.manager;if(void 0===n||"function"!=typeof n.get)return;const r=n.get(t);return null===r||void 0===r||"object"!=typeof r?void 0:r}catch{return}}
function omoA1ChildHandle(e,t){try{const n=e.manager;if(void 0===n||"function"!=typeof n.getResidentHandle)return;const r=n.getResidentHandle(t);return null===r||void 0===r||"object"!=typeof r?void 0:r}catch{return}}
function omoA1ChildSessionId(e,t){const n=omoA1ChildRecord(e,t);if(void 0!==n&&"string"==typeof n.child_session_id&&n.child_session_id.length>0)return n.child_session_id;const r=omoA1ChildHandle(e,t);if(void 0!==r&&"string"==typeof r.sessionId&&r.sessionId.length>0)return r.sessionId;const i=omoA1TaskSessionIds(e.stateDir,t);return 0===i.length?void 0:i[i.length-1]}
function omoA1ChildIsInProcess(e,t){const n=omoA1ChildHandle(e,t);if(void 0!==n&&"in-process"===n.kind)return!0;const r=omoA1ChildRecord(e,t);return void 0!==r&&"in-process"===r.execution_mode}
function omoA1ChildTouchPaths(e,t){try{if("string"!=typeof e||null===t||"object"!=typeof t||Array.isArray(t))return[];if(omoA1ChildToolNames.has(e)){const n=t.path;return "string"==typeof n&&omoA1PlanPathShape.test(n)?[n.replace(/\\/g,"/")]:[]}if("apply_patch"===e){const n=t.input;if("string"!=typeof n)return[];const r=n.match(omoA1PlanPatchShape);if(null===r)return[];const i=[];for(const e of r){const t=e.replace(/\\/g,"/");i.includes(t)||i.push(t)}return i}return[]}catch{return[]}}
function omoA1WatchEvent(e,t,n,r){try{if(null===r||void 0===r||"object"!=typeof r||"string"!=typeof r.toolCallId)return;if("tool_execution_start"===r.type){if(e.pending.size>128)e.pending.clear();e.pending.set(r.toolCallId,{toolName:r.toolName,args:r.args});return}if("tool_execution_end"!==r.type)return;const i=e.pending.get(r.toolCallId);if(e.pending.delete(r.toolCallId),void 0===i||!0===r.isError)return;const o=omoA1ChildTouchPaths(i.toolName,i.args);if(0===o.length||!omoA1ChildIsInProcess(e,n))return;const s=omoA1ChildSessionId(e,n);if(void 0===s)return;const a=t.get(s)??new Map();for(const t of o){e.childSeq+=1;const n=a.get(t);a.set(t,{count:(n?.count??0)+1,lastTouchedAt:e.childSeq})}t.set(s,a),omoA1Flush(e,s,t,Date.now())}catch{}}
function omoA1WatchScan(e,t){try{const n=e.manager;if(void 0===n||null===n||"object"!=typeof n||"function"!=typeof n.list||"function"!=typeof n.subscribeChild)return;const r=n.list({scope:"all"});if(!Array.isArray(r))return;for(const i of r){const o=i?.record;if(null===o||void 0===o||"object"!=typeof o)continue;const s=o.task_id;if("string"!=typeof s||0===s.length||e.watched.has(s))continue;const a=omoA1ChildHandle(e,s);if(omoA1TerminalStatuses.has(o.status)&&void 0===a)continue;if(void 0!==o.execution_mode&&"in-process"!==o.execution_mode&&"in-process"!==a?.kind)continue;e.watched.add(s);try{e.watchUnsubs.set(s,n.subscribeChild(s,r=>omoA1WatchEvent(e,t,s,r)))}catch{e.watched.delete(s)}}}catch{}}
function omoA1WatchStart(e,t){try{if(!0===e.watchStarted)return;e.watchStarted=!0;const n=e.engine;if(void 0!==n&&null!==n&&"function"==typeof n.onStoreMutation)try{e.watchStoreUnsub=n.onStoreMutation(()=>omoA1WatchScan(e,t))}catch{}omoA1WatchScan(e,t)}catch{}}
function omoA1WatchStop(e){try{if("function"==typeof e.watchStoreUnsub)try{e.watchStoreUnsub()}catch{}e.watchStoreUnsub=void 0;for(const t of e.watchUnsubs.values())try{"function"==typeof t&&t()}catch{}e.watchUnsubs.clear()}catch{}}
function omoA1CreateState(e){const t={stateDir:"",projectKey:"unknown",manager:void 0,engine:void 0,stamps:new Map,lastWritten:new Map,revisions:new Map,inFlight:new Set,writes:0,watched:new Set,watchUnsubs:new Map,pending:new Map,childSeq:0,watchStarted:!1,watchStoreUnsub:void 0};try{t.stateDir=omoA1StateDir(e),t.projectKey=omoA1ProjectKey(t.stateDir)}catch{}try{t.manager=e?.manager}catch{}try{t.engine=e?.engine}catch{}return t}
function omoA1Listen(e,t,n){omoGateRepairListen(e,t);const r=e=>{try{"string"==typeof e&&e.length>0&&omoA1Flush(t,e,n,Date.now())}catch{}};try{e.on("tool_result",(e,t)=>{r(nY(t))}),e.on("input",(e,t)=>{r(nY(t))}),e.on("session_shutdown",(e,i)=>{r(nY(i)),omoA1WatchStop(t)})}catch{}omoA1WatchStart(t,n)}
