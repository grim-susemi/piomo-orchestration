import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyGateRepair } from './gate-repair-anchor.mjs';
import { extractMethod, functionFromSource, loadStaged } from '../engine-bridge/lib.mjs';

const base = new URL('../../base/omo-ai/plugin/extensions/omo-task.js', import.meta.url);
const auditCases = [
  'closure-read-link', 'closure-command-link', 'closure-read-open',
  'closure-input-link', 'closure-input-open', 'closure-collision', 'closure-nonexecute-link',
  'execute-dollar', 'execute-whitespace', 'execute-newline', 'execute-chain',
  'expand-fenced-dollar', 'expand-quoted-dollar',
  'request-pending', 'request-transformed', 'request-rejected', 'request-natural',
  'request-rejected-first-execute', 'request-handled-first-execute',
  'pre-read-block', 'pre-read-pending', 'pre-read-success', 'pre-read-failed',
  'pre-read-interleaved', 'pre-read-result-failure', 'pre-read-result-link-failure', 'pre-read-release-failure', 'pre-read-narrow',
  'pre-read-later-veto', 'pre-read-effect-after-reentry', 'pre-read-effect-after-reentry-failure',
  'pre-read-synthetic-abort', 'pre-read-synthetic-abort-failure', 'pre-read-resolved-error', 'pre-read-mutated-result',
  'pre-read-foreign-id-success-target-success', 'pre-read-foreign-id-success-target-failure',
  'pre-read-foreign-id-failure-target-success', 'pre-read-foreign-id-failure-target-failure',
  'pre-read-duplicate-matching-before'
];

if (process.argv.includes('--fixture')) {
  const source = applyGateRepair(readFileSync(base, 'utf8')).text;
  // Exercise source-stage bytes directly; the engine integration lane owns materialization/pins.
  const tracker = source.slice(source.indexOf('function eY(e,omoA1Ctx)'), source.indexOf('function tY(e)'));
  assert.ok(source.includes('if("extension"===i.source)return;let a=i.text,s=nY(r);'), 'the generated handler must guard the splice seam with the upstream extension-only input check');
  const gate = source.slice(source.indexOf('function Pu(e,t)'), source.indexOf('var Nu=', source.indexOf('function Pu(e,t)')));
  const definitions = source.slice(source.indexOf('var HV='), source.indexOf('function eY(e,omoA1Ctx)'));
  const { defs } = await import('./gate-repair-anchor.mjs').then(({ readGateRepairFragment }) => readGateRepairFragment());
  // The generated tracker and native gate run together, with only their host/event boundary stubbed.
  const body = `${definitions}\n${tracker}\n${gate}\n${defs.replace(/^import.*;\n/gm, '')}\nreturn {eY,Pu};`;
  const make = new Function('nY', 'rY', 'tY', 'Ou', 'ogRJoin', 'ogRCreateHash', 'ogRReadFileSync', 'ogRReaddirSync', 'ogRMkdirSync', 'ogRDirname', 'ogRWriteFileSync', 'ogRRenameSync', 'ogRRmSync', 'ogROpenSync', 'ogRCloseSync', 'ogRLinkSync', 'ogRFsyncSync', 'ogRRandomUUID', body);
  // Full A1 imports are unnecessary: test a touched plan in the live session's memory view.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const native = { requiresSkills: ['ulw-plan'], forbidsSkills: ['ulw-execute'], requiresPlanArtifact: true };
  let renameHook, linkHook, openHook, denyWrites;
  const mutating = () => { if (denyWrites) throw denyWrites; };
  const { eY, Pu } = make(ctx => ctx?.sessionManager?.getSessionId(), p => p.split(String.fromCharCode(92)).join('/'), v => !!v && typeof v === 'object', () => native,
    path.join, crypto.createHash, fs.readFileSync, fs.readdirSync,
    (...args) => { mutating(); return fs.mkdirSync(...args); }, path.dirname,
    (...args) => { mutating(); return fs.writeFileSync(...args); },
    (from, to) => { mutating(); if (renameHook && to.includes('plan-requests')) { const hook = renameHook; renameHook = undefined; hook(from, to); } return fs.renameSync(from, to); },
    (...args) => { mutating(); return fs.rmSync(...args); },
    (file, flags) => { if (flags !== 'r') mutating(); if (openHook) openHook(file, flags); return fs.openSync(file, flags); }, fs.closeSync,
    (from, to) => { mutating(); if (linkHook) { const hook = linkHook; linkHook = undefined; hook(from, to); } return fs.linkSync(from, to); }, fs.fsyncSync, crypto.randomUUID);
  let nextInput = 0;
  const emit = (handlers, name, ...args) => {
    // The older matrix's shorthand means a complete authentic input/admission lifecycle.
    // Explicit input IDs below exercise pending, rejected, transformed, and failed admission.
    const autoAdmit = name === 'input' && args[0].inputId === undefined;
    if (autoAdmit) args[0] = { originalText: args[0].text, ...args[0], inputId: 'fixture-auto-' + (++nextInput) };
    for (const fn of handlers.get(name) ?? []) {
      const result = fn(...args);
      if (result?.action === 'handled' || result?.block) return result;
    }
    if (autoAdmit) emit(handlers, 'input_disposition', { inputId: args[0].inputId, disposition: 'started' }, args[1]);
  };
  const listen = handlers => ({ on(name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); } });
  const readInvocations = new WeakMap();
  let nextRead = 0;
  const readLifecycle = (handlers, event, ctx) => {
    const toolCallId = event.toolCallId ?? 'fixture-read-' + (++nextRead);
    let seen = readInvocations.get(handlers);
    if (!seen) readInvocations.set(handlers, seen = new Set());
    if (!seen.has(toolCallId)) {
      emit(handlers, 'tool_effect_before', { ...event, type: 'tool_effect_before', toolCallId }, ctx);
      seen.add(toolCallId);
    }
    emit(handlers, 'tool_effect_settled', { ...event, type: 'tool_effect_settled', toolCallId, ok: true }, ctx);
    emit(handlers, 'tool_result', { ...event, toolCallId }, ctx);
  }; // Repeating an identity simulates duplicate settlement callbacks, not another invocation.
  const bounded = (promise, label) => {
    let timeout;
    const cap = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(label + ' timed out')), 10000); });
    return Promise.race([promise, cap]).finally(() => clearTimeout(timeout));
  };
  if (process.argv.includes('--gate-view-only')) {
    const [stateDir, session] = process.argv.slice(process.argv.indexOf('--gate-view-only') + 1);
    console.log(Pu('plan-reviewer', eY({ on() {} }, { stateDir }).stateFor(session)).kind);
    process.exit(0);
  }
  if (process.argv.includes('--execute-only')) {
    const [stateDir, session, toolCallId] = process.argv.slice(process.argv.indexOf('--execute-only') + 1);
    const handlers = new Map();
    eY(listen(handlers), { stateDir });
    const event = { type: 'tool_result', toolCallId, toolName: 'read', input: { path: '/skills/ulw-execute/SKILL.md' }, isError: false };
    const ctx = { sessionManager: { getSessionId: () => session } };
    if (process.argv.includes('--settled-only')) emit(handlers, 'tool_effect_settled', { ...event, type: 'tool_effect_settled', ok: true }, ctx);
    else readLifecycle(handlers, event, ctx);
    process.exit(0);
  }
  const externalExecute = (stateDir, session, id, settledOnly = false) => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', '--execute-only', stateDir, session, id, ...(settledOnly ? ['--settled-only'] : [])], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr || child.stdout || String(child.error));
  };
  const auditCase = process.argv[process.argv.indexOf('--audit-case') + 1];
  if (process.argv.includes('--audit-case')) {
    assert.ok(auditCases.includes(auditCase));
    const stateDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-audit-'));
    const handlers = new Map(), tracker = eY(listen(handlers), { stateDir });
    const ctx = { sessionManager: { getSessionId: () => 'audit-owner' } };
    const input = (id, originalText, text = originalText) => emit(handlers, 'input', { inputId: id, originalText, text, source: 'interactive' }, ctx);
    const admit = (id, disposition = 'started') => emit(handlers, 'input_disposition', { inputId: id, disposition }, ctx);
    const readEvent = id => ({ type: 'tool_result', toolCallId: id, toolName: 'read', input: { path: '/skills/ulw-execute/SKILL.md' }, isError: false });
    const views = () => ({
      live: Pu('plan-reviewer', tracker.stateFor('audit-owner')).kind,
      reload: Pu('plan-reviewer', eY({ on() {} }, { stateDir }).stateFor('audit-owner')).kind
    });
    const freshView = () => {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', '--gate-view-only', stateDir, 'audit-owner'], { encoding: 'utf8', timeout: 10000 });
      assert.equal(child.status, 0, child.stderr);
      return child.stdout.trim();
    };
    try {
      emit(handlers, 'tool_result', { type: 'tool_result', toolName: 'read', input: { path: '.omo/plans/audit.md' }, isError: false }, ctx);
      if (auditCase.endsWith('-first-execute')) {
        input('first-plan', '/skill:ulw-plan'); admit('first-plan');
        assert.deepEqual(views(), { live: 'allow', reload: 'allow' });
        input('first-execute', '/skill:ulw-execute');
        assert.equal(views().live, 'deny', 'pending intent provisionally denies');
        admit('first-execute', auditCase.includes('-rejected-') ? 'rejected' : 'handled');
        assert.deepEqual(views(), { live: 'allow', reload: 'allow' }, 'unadmitted execute must not leave executed:true at epoch zero');
        assert.equal(freshView(), 'allow', 'rejected or handled first execute does not poison process reload');
        assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, 'plan-requests/audit-owner.json'), 'utf8')).executed, false);
        assert.equal(fs.existsSync(path.join(stateDir, 'plan-executions/audit-owner.json')), false);
        input('unrelated', 'hello'); admit('unrelated'); admit('first-execute');
        assert.equal(freshView(), 'allow', 'sticky native invocation and duplicate disposition cannot invent execution');
      } else if (auditCase.startsWith('request-')) {
        const natural = auditCase === 'request-natural';
        input('request', auditCase === 'request-transformed' ? 'hello' : natural ? 'please review the plan' : '/skill:ulw-plan', natural ? 'please review the plan' : '/skill:ulw-plan');
        if (auditCase === 'request-transformed') admit('request');
        if (auditCase === 'request-rejected') admit('request', 'rejected');
        assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, auditCase + ': original owner admission is required even at epoch zero');
        if (natural) {
          admit('request');
          assert.deepEqual(views(), { live: 'allow', reload: 'allow' }, 'authentic admitted natural-language request remains supported');
        }
      } else {
        readLifecycle(handlers, readEvent('initial-execute'), ctx);
        input('reopen', '/skill:ulw-plan'); admit('reopen');
        assert.deepEqual(views(), { live: 'allow', reload: 'allow' }, 'audit begins with durable reentry');
        if (auditCase.startsWith('expand-')) {
          const core = path.join(process.env.APPDATA, 'npm/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/core');
          const { AgentSession } = await import(pathToFileURL(path.join(core, 'agent-session.js')).href);
          const skillPath = path.join(stateDir, 'skills/ulw-execute/SKILL.md');
          fs.mkdirSync(path.dirname(skillPath), { recursive: true });
          fs.writeFileSync(skillPath, 'execute-fixture');
          const emitted = [], errors = [];
          const host = {
            resourceLoader: { getSkills: () => ({ skills: [{ name: 'ulw-execute', filePath: skillPath, baseDir: path.dirname(skillPath) }] }) },
            _extensionRunner: { emitError: error => errors.push(error) },
            _emit: event => emitted.push(event)
          };
          const command = auditCase === 'expand-fenced-dollar' ? '```text\n$ulw-execute plan\n```' : '"example $ulw-execute plan"';
          input('expanded-execute', command);
          AgentSession.prototype._expandSkillCommand.call(host, command);
          assert.deepEqual(errors, []);
          assert.deepEqual(emitted.filter(event => event.type === 'skill_invocation').flatMap(event => event.skills.map(skill => skill.name)), ['ulw-execute'], 'actual installed parser expands this quoted/fenced command');
          admit('expanded-execute');
          assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, 'native skill invocation must revoke even inside quoted/fenced original input');
          assert.equal(freshView(), 'deny');
        } else if (auditCase.startsWith('pre-read-')) {
          // Run pinned staged runner/wrapper methods with the unchanged real AgentSession
          // preflight/result pipeline. Only context/UI and the tool definition are fixtures.
          const core = path.join(process.env.APPDATA, 'npm/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/core');
          const [{ ExtensionRunner }, { AgentSession }, { wrapToolDefinition }] = await Promise.all([
            import(pathToFileURL(path.join(core, 'extensions/runner.js')).href),
            import(pathToFileURL(path.join(core, 'agent-session.js')).href),
            import(pathToFileURL(path.join(core, 'tools/tool-definition-wrapper.js')).href)
          ]);
          const { staged } = loadStaged(fileURLToPath(new URL('../../../', import.meta.url)), fileURLToPath(new URL('../engine-bridge/', import.meta.url)));
          const runnerSource = staged.get('dist/core/extensions/runner.js');
          const wrapperSource = staged.get('dist/core/extensions/wrapper.js');
          const dispatch = signature => functionFromSource(extractMethod(runnerSource, signature, signature));
          const wrap = functionFromSource(extractMethod(wrapperSource, 'export function wrapRegisteredTool(registeredTool, runner, createToolContext) {', 'staged wrapper'), { wrapToolDefinition });
          const errors = [], statuses = [], calls = [], effectEvents = []; 
          const runner = Object.assign(Object.create(ExtensionRunner.prototype), {
            extensions: [
              { path: 'effect-observer', handlers: new Map([
                ['tool_effect_before', [event => { effectEvents.push({ ...event }); }]],
                ['tool_effect_settled', [event => { effectEvents.push({ ...event }); }]]
              ]) },
              { path: 'staged-slot-4', handlers }
            ],
            emitToolCall: dispatch('async emitToolCall(event) {'),
            emitToolEffectBefore: dispatch('emitToolEffectBefore(event) {'),
            emitToolEffectSettled: dispatch('async emitToolEffectSettled(event) {'),
            getActiveTools: () => ['read'],
            createContext: () => ctx,
            beginToolHookRun: () => ({ context: ctx, end: status => statuses.push(status) }),
            emitError: error => errors.push(error)
          });
          const skillPath = path.join(stateDir, 'skills/ulw-execute/SKILL.md');
          fs.mkdirSync(path.dirname(skillPath), { recursive: true });
          fs.writeFileSync(skillPath, 'execute-fixture');
          let readEffects = 0, failRead = false, afterEffect, definitionGate, entered;
          let resolvedError = auditCase === 'pre-read-resolved-error';
          const tool = {
            name: 'read', label: 'read', description: '',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            async execute(id, args) {
              calls.push(id);
              assert.equal(views().live, 'deny', 'final effect reservation is durable before definition execution');
              if (definitionGate) { entered.resolve(id); await definitionGate.promise; }
              if (resolvedError) return { content: [], isError: true };
              if (failRead) { afterEffect?.(); throw Object.assign(new Error('injected failed read'), { code: 'ENOENT' }); }
              const text = fs.readFileSync(args.path, 'utf8');
              readEffects += 1;
              afterEffect?.();
              return { content: [{ type: 'text', text }] };
            }
          };
          const wrapped = wrap({ definition: tool }, runner);
          const host = {
            agent: { state: { tools: [wrapped] } }, _toolExecutionDepth: 0, _extensionRunner: runner,
            getActiveToolNames: () => ['read'], settingsManager: { getImageAutoResize: () => false },
            preflightToolCall: AgentSession.prototype.preflightToolCall,
            _emitAfterToolCallHooks: AgentSession.prototype._emitAfterToolCallHooks
          };
          const runRead = signal => AgentSession.prototype.executeTool.call(host, 'read', { path: skillPath }, { signal });
          if (auditCase === 'pre-read-duplicate-matching-before') {
            definitionGate = Promise.withResolvers(); entered = Promise.withResolvers();
            const running = runRead();
            const invocationId = await bounded(entered.promise, 'first matching definition entry');
            try {
              let duplicateEffects = 0, duplicateError;
              const duplicate = wrap({ definition: { ...tool, async execute() {
                duplicateEffects += 1;
                return { content: [] };
              } } }, runner);
              const args = { path: skillPath };
              assert.equal((await runner.emitToolCall({ type: 'tool_call', toolCallId: invocationId, toolName: 'read', input: args }))?.block, undefined);
              try { await bounded(duplicate.execute(invocationId, args), 'duplicate matching invocation'); }
              catch (error) { duplicateError = error; }
              assert.equal(duplicateEffects, 0, 'duplicate matching id must be rejected before the second definition executes');
              assert.ok(duplicateError instanceof Error, 'before failure propagates from the real wrapper');
              assert.throws(() => runner.emitToolEffectBefore({ type: 'tool_effect_before', toolCallId: invocationId, toolName: 'read', input: args }), 'duplicate before is rejected synchronously');
              assert.equal(effectEvents.filter(event => event.type === 'tool_effect_settled').length, 0, 'blocked duplicate must not emit settlement for the live original');
              assert.equal(readEffects, 0, 'first definition remains suspended');
              assert.equal(freshView(), 'deny');
            } finally {
              definitionGate.resolve();
              await bounded(running, 'first matching settlement');
            }
            assert.equal(readEffects, 1, 'only the original definition executes');
            assert.deepEqual(errors, []);
            assert.equal(freshView(), 'deny', 'original success still closes');
            input('after-original', '/skill:ulw-plan'); admit('after-original');
            assert.equal(freshView(), 'allow', 'original settlement leaves no stranded duplicate reservation');
          } else if (auditCase.startsWith('pre-read-foreign-id-')) {
            const foreignFails = auditCase.includes('foreign-id-failure');
            failRead = auditCase.endsWith('target-failure');
            definitionGate = Promise.withResolvers(); entered = Promise.withResolvers();
            const running = runRead();
            const invocationId = await bounded(entered.promise, 'target definition entry');
            try {
              assert.equal(readEffects, 0, 'genuine target remains suspended');
              assert.deepEqual(views(), { live: 'deny', reload: 'deny' });
              const epochDir = path.join(stateDir, 'plan-epochs/audit-owner');
              const journal = () => fs.readdirSync(epochDir).sort().map(name => [name, fs.readFileSync(path.join(epochDir, name), 'utf8')]);
              const pendingJournal = journal();
              const foreignPath = path.join(stateDir, 'notes.md');
              fs.writeFileSync(foreignPath, 'foreign-read-fixture');
              let foreignEffects = 0;
              const foreign = wrap({ definition: { ...tool, async execute(_id, args) {
                const text = fs.readFileSync(args.path, 'utf8');
                foreignEffects += 1;
                if (foreignFails) throw new Error('foreign read failed');
                return { content: [{ type: 'text', text }] };
              } } }, runner);
              const args = { path: foreignPath };
              assert.equal((await runner.emitToolCall({ type: 'tool_call', toolCallId: invocationId, toolName: 'read', input: args }))?.block, undefined);
              const foreignRun = foreign.execute(invocationId, args);
              if (foreignFails) await assert.rejects(bounded(foreignRun, 'foreign failure'), /foreign read failed/);
              else await bounded(foreignRun, 'foreign success');
              assert.equal(foreignEffects, 1, 'foreign read used the real wrapper with the duplicate id');
              assert.equal(readEffects, 0, 'foreign settlement cannot complete the real target');
              assert.deepEqual(journal(), pendingJournal, 'foreign duplicate-id settlement must not advance epoch or release target reservation');
              assert.deepEqual(views(), { live: 'deny', reload: 'deny' });
              assert.equal(freshView(), 'deny', 'target stays pending across process recreation');
            } finally {
              definitionGate.resolve();
              await bounded(running, 'target settlement');
            }
            assert.equal(readEffects, failRead ? 0 : 1);
            assert.deepEqual(errors, []);
            assert.equal(freshView(), failRead ? 'allow' : 'deny', 'only target own failure releases, and target own success closes');
          } else if (auditCase === 'pre-read-later-veto') {
            input('execute-before-veto', '/skill:ulw-execute'); admit('execute-before-veto');
            const epochDir = path.join(stateDir, 'plan-epochs/audit-owner');
            const beforeVeto = fs.readdirSync(epochDir).sort();
            runner.extensions.push({ path: 'later-veto', handlers: new Map([['tool_call', [() => ({ block: true, reason: 'fixture later veto' })]]]) });
            await assert.rejects(runRead(), { code: 'blocked' });
            assert.equal(readEffects, 0);
            assert.deepEqual(effectEvents, [], 'later veto must emit zero effect lifecycle events');
            assert.deepEqual(fs.readdirSync(epochDir).sort(), beforeVeto, 'later veto creates NO reservation');
            assert.equal(freshView(), 'deny', 'only the earlier admitted execute still forbids review');
            input('reopen', '/skill:ulw-plan'); admit('reopen');
            assert.equal(freshView(), 'deny', 'duplicate old admission cannot acknowledge a new reservation');
            input('ordinary-review', 'please review the plan'); admit('ordinary-review');
            assert.equal(freshView(), 'deny', 'ordinary request cannot acknowledge pending execution after execute');
            input('after-veto', '/skill:ulw-plan');
            assert.equal(freshView(), 'deny', 'fresh exact input still needs admission');
            admit('after-veto');
            assert.deepEqual(views(), { live: 'allow', reload: 'allow' }, 'fresh owner admission reopens because vetoed read left no pending intent');
            assert.equal(freshView(), 'allow', 'reentry after later veto survives actual process reload');
            await assert.rejects(runRead(), { code: 'blocked' });
            assert.deepEqual(effectEvents, []);
            assert.equal(freshView(), 'allow', 'another veto cannot fabricate a read execution or reservation');
            input('after-second-veto', '/skill:ulw-plan'); admit('after-second-veto');
            assert.equal(freshView(), 'allow');
          } else if (auditCase.startsWith('pre-read-effect-after-reentry')) {
            if (auditCase.endsWith('-failure')) afterEffect = () => { denyWrites = Object.assign(new Error('all durable writes fail after acknowledged intent executes'), { code: 'EPERM' }); };
            input('before-reserve', '/skill:ulw-plan');
            runner.extensions.push({ path: 'owner-input-between-reservation-and-effect', handlers: new Map([['tool_call', [() => {
              admit('before-reserve');
              assert.deepEqual(effectEvents, [], 'all tool_call handlers run BEFORE final effect reservation');
              assert.equal(views().live, 'allow', 'before final reservation the admitted owner plan remains valid');
              input('after-reserve', '/skill:ulw-plan'); admit('after-reserve');
              assert.equal(freshView(), 'allow', 'owner admission between tool_call and final effect is valid until execution starts');
            }]]]) });
            await runRead();
            denyWrites = undefined;
            assert.equal(readEffects, 1);
            if (auditCase.endsWith('-failure')) {
              assert.ok(errors.length > 0, 'real post-tool runner reports failed closure after the effect');
              assert.equal(freshView(), 'deny', 'acknowledging pending intent must not reintroduce the all-write-fail reload bypass');
            }
            assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, 'successful result after reentry advances the epoch again');
            assert.equal(freshView(), 'deny');
          } else if (auditCase === 'pre-read-block') {
            denyWrites = Object.assign(new Error('all durable writes unavailable'), { code: 'EPERM' });
            const result = await runRead();
            denyWrites = undefined;
            assert.equal(readEffects, 0, 'synchronous final-before throw must prevent the SKILL.md read effect');
            assert.equal(result.details?.isError, true, 'AgentSession surfaces the wrapper failure as a tool error');
            assert.equal(statuses.includes('blocked'), false, 'ordinary tool_call is not the reservation owner');
            assert.deepEqual(effectEvents.map(event => event.type), ['tool_effect_before'], 'failed reservation has no actual settlement');
            assert.equal(errors.length, 0, 'before failure is propagated rather than swallowed');
            assert.equal(freshView(), 'allow', 'blocked read did not execute, so prior admission remains valid after reload');
          } else if (auditCase === 'pre-read-pending' || auditCase.startsWith('pre-read-synthetic-abort')) {
            definitionGate = Promise.withResolvers(); entered = Promise.withResolvers();
            const controller = new AbortController();
            const running = runRead(controller.signal);
            const invocationId = await bounded(entered.promise, 'definition entry');
            assert.equal(readEffects, 0, 'actual definition is suspended before reading');
            assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, 'true in-flight invocation remains denied');
            assert.equal(freshView(), 'deny', 'true pending invocation survives process reload');
            controller.abort();
            await runner.emitToolResult({ ...readEvent(invocationId), input: { path: skillPath }, isError: true, content: [] });
            assert.equal(effectEvents.filter(event => event.type === 'tool_effect_settled').length, 0, 'synthetic abort is not actual promise settlement');
            input('during-effect', '/skill:ulw-plan'); admit('during-effect');
            assert.notEqual(invocationId, 'during-effect', 'tool invocation and prompt input identities are independent');
            assert.equal(freshView(), 'deny', 'synthetic tool_result plus owner input cannot release live invocation');
            const rejected = auditCase !== 'pre-read-synthetic-abort';
            if (rejected) definitionGate.reject(new Error('definitive read failure'));
            else definitionGate.resolve();
            await bounded(running, 'definition settlement');
            const settled = effectEvents.filter(event => event.type === 'tool_effect_settled');
            assert.equal(settled.length, 1);
            assert.equal(settled[0].ok, !rejected);
            assert.equal(readEffects, rejected ? 0 : 1);
            assert.equal(freshView(), rejected ? 'allow' : 'deny', 'only the actual promise outcome releases or closes the reservation');
          } else if (auditCase === 'pre-read-narrow') {
            denyWrites = Object.assign(new Error('all durable writes unavailable'), { code: 'EPERM' });
            for (const [toolName, file] of [['read', '.omo/plans/test.md'], ['read', '/skills/ulw-plan/SKILL.md'], ['read', '/skills/ulw-execute/SKILL.md.bak'], ['write', skillPath]]) {
              assert.doesNotThrow(() => runner.emitToolEffectBefore({ type: 'tool_effect_before', toolCallId: toolName + file, toolName, input: { path: file } }), 'unrelated final effects are not storage-gated');
            }
            denyWrites = undefined;
            assert.equal(readEffects, 0);
          } else {
            failRead = ['pre-read-failed', 'pre-read-interleaved', 'pre-read-release-failure'].includes(auditCase);
            if (resolvedError || auditCase === 'pre-read-mutated-result') runner.extensions.push({ path: 'mutable-tool-result', handlers: new Map([['tool_result', [() => ({ isError: !resolvedError })]]]) });
            if (auditCase === 'pre-read-interleaved') afterEffect = () => externalExecute(stateDir, 'audit-owner', 'other-execute');
            if (['pre-read-result-failure', 'pre-read-release-failure'].includes(auditCase)) afterEffect = () => { denyWrites = Object.assign(new Error('all post-effect durable writes unavailable'), { code: 'EPERM' }); };
            if (auditCase === 'pre-read-result-link-failure') afterEffect = () => { linkHook = () => { throw Object.assign(new Error('post-effect link failure'), { code: 'EPERM' }); }; };
            await runRead();
            denyWrites = undefined;
            assert.equal(readEffects, failRead || resolvedError ? 0 : 1);
            const expected = auditCase === 'pre-read-failed' || resolvedError ? 'allow' : 'deny';
            assert.equal(freshView(), expected, 'reservation/result state survives real process replacement');
            if (auditCase.endsWith('-failure')) {
              assert.ok(errors.length > 0, 'real post-tool runner reports the failed reconciliation');
              await runner.emitToolEffectSettled({ type: 'tool_effect_settled', toolCallId: calls[0], toolName: 'read', input: { path: skillPath }, ok: !failRead, ...(failRead ? { error: 'definitive read failure' } : { isError: false }) });
              assert.equal(freshView(), failRead ? 'allow' : 'deny', 'replayed result safely reconciles the same reservation');
            }
            if (!failRead && !resolvedError) {
              input('after-reserved-read-typo', '/skill/ulw-plan'); admit('after-reserved-read-typo');
              assert.equal(freshView(), 'deny', 'the independent QA slash typo is not exact colon-form reentry');
              input('after-reserved-read', '/skill:ulw-plan'); admit('after-reserved-read');
              assert.equal(freshView(), 'allow', 'fresh admission reopens after successful read reconciliation');
              await runner.emitToolResult({ ...readEvent(calls[0]), input: { path: skillPath }, content: [] });
              await runner.emitToolEffectSettled({ type: 'tool_effect_settled', toolCallId: calls[0], toolName: 'read', input: { path: skillPath }, ok: true, isError: false });
              assert.equal(freshView(), 'allow', 'ordinary fallback and duplicate settlement do not execute twice');
            }
          }
        } else if (auditCase === 'closure-collision') {
          linkHook = () => externalExecute(stateDir, 'audit-owner', 'collision-winner');
          readLifecycle(handlers, readEvent('collision-loser'), ctx);
          assert.deepEqual(views(), { live: 'deny', reload: 'deny' });
          assert.equal(fs.readdirSync(path.join(stateDir, 'plan-epochs', 'audit-owner')).some(name => name.endsWith('.tmp')), false, 'EEXIST losers leave no unresolved staging');
          input('after-collision', '/skill:ulw-plan'); admit('after-collision');
          assert.deepEqual(views(), { live: 'allow', reload: 'allow' }, 'successful execute collision does not strand denial');
        } else if (auditCase === 'closure-nonexecute-link') {
          const error = Object.assign(new Error('injected non-execute journal EPERM'), { code: 'EPERM' });
          linkHook = () => { throw error; };
          assert.deepEqual(input('failed-plan', '/skill:ulw-plan'), { action: 'handled' });
          assert.equal(fs.readdirSync(path.join(stateDir, 'plan-epochs', 'audit-owner')).some(name => name.endsWith('.tmp')), false, 'non-execute staging is cleaned after failure');
          assert.deepEqual(views(), { live: 'allow', reload: 'allow' }, 'failed plan input does not fabricate execution');
        } else if (auditCase.startsWith('closure-input-')) {
          const error = Object.assign(new Error('injected execute input EPERM'), { code: 'EPERM' });
          if (auditCase.endsWith('-open')) openHook = (file, flags) => { if (file.includes('plan-epochs') && flags === 'wx') throw error; };
          else linkHook = () => { throw error; };
          assert.deepEqual(input('not-admitted', '/skill:ulw-execute'), { action: 'handled' }, 'input handler propagates veto instead of throwing into a swallowing runner');
          openHook = undefined;
          assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, 'process latch blocks after failed execute input');
        } else if (auditCase.startsWith('closure-')) {
          const command = auditCase === 'closure-command-link';
          if (command) input('later-execute', '/skill:ulw-execute');
          if (!command) {
            emit(handlers, 'tool_effect_before', { ...readEvent('later-execute'), type: 'tool_effect_before' }, ctx);
            assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, 'final lifecycle reserves before the read effect');
          }
          const error = Object.assign(new Error('injected execute journal EPERM'), { code: 'EPERM' });
          if (auditCase.endsWith('-open')) openHook = (file, flags) => { if (file.includes('plan-epochs') && flags === 'wx') throw error; };
          else linkHook = () => { throw error; };
          // Staged effect settlement reports errors and continues; its durable pending
          // reservation must remain authoritative when publication fails.
          const errors = [];
          const eventName = command ? 'input_disposition' : 'tool_effect_settled';
          const event = command ? { type: 'input_disposition', inputId: 'later-execute', disposition: 'started' } : { ...readEvent('later-execute'), type: 'tool_effect_settled', ok: true };
          for (const handler of handlers.get(eventName) ?? []) {
            try { handler(event, ctx); } catch (caught) { errors.push(caught); }
          }
          openHook = undefined;
          assert.equal(errors.length, 1, 'runner reports exactly the injected storage failure');
          assert.equal(errors[0], error);
          assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, auditCase + ': failed closure must not preserve allow in this process');
          const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', '--gate-view-only', stateDir, 'audit-owner'], { encoding: 'utf8', timeout: 10000 });
          assert.equal(child.status, 0, child.stderr);
          assert.equal(child.stdout.trim(), 'deny', 'unresolved execute evidence denies in a genuinely fresh process');
        } else {
          const command = {
            'execute-dollar': '$ulw-execute plan',
            'execute-whitespace': '  /skill:ulw-execute plan',
            'execute-newline': '/skill:ulw-execute\nplan',
            'execute-chain': '/skill:ulw-plan /skill:ulw-execute plan'
          }[auditCase];
          input('later-execute', command); admit('later-execute');
          assert.deepEqual(views(), { live: 'deny', reload: 'deny' }, auditCase + ': native expansion must revoke without a tool read');
        }
      }
    } finally {
      openHook = undefined; linkHook = undefined; denyWrites = undefined;
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    process.exit(0);
  }
  const cases = [
    ['mass ulwplan', true], ['오키 제대로 ulwplan 잡자', true],
    ['<skill name="ulw-plan">start</skill>', true],
    ['우리 옵티스케일 obs 적용한 프리릴리즈버전을 개선 작업 들어가야함. 지금 현재 우리 수세미옵티 최신 릴리즈가 결함 없이 최신 기술이니까. 그걸 삽입? 한다는 생각 으로 판단해서 mass ulwplan', true],
    ['우리 옵티스케일 obs 개선 작업 들어가야함. "mass ulwplan"', false],
    ['우리 옵티스케일 obs 개선 작업 들어가야함. mass ulwplan이 뭐야?', false],
    ['`mass ulwplan`', false], ['"오키 제대로 ulwplan 잡자"', false],
    ['"계획 리뷰 해줘"', false], ['```xml\n<skill name="ulw-plan">example</skill>\n```', false],
    ['"<skill name="ulw-plan">example</skill>"', false],
    ["'<skill name=\"ulw-plan\">example</skill>'", false],
    ["'Example: <skill name=\"ulw-plan\">example</skill>'", false],
    ['"Example: <skill name="ulw-plan">example</skill>"', false],
    ['`<skill name="ulw-plan">example</skill>`', false],
    ["'mass ulwplan'", false],
    ['```\nmass ulwplan\n```', false], ['what is ulwplan?', false],
    ['ulwplan이 뭐야?', false], ['ulw', false], ['ulw-execute', false]
  ];
  // Policy A: a raw, admitted owner command can acknowledge the current execute epoch.
  // Freeze the clock: order is deliberately not representable by timestamps.
  const realNow = Date.now;
  Date.now = () => 1800000000000;
  const reentryDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-reentry-'));
  try {
    const handlers = new Map();
    const tracker = eY(listen(handlers), { stateDir: reentryDir });
    const ctx = { sessionManager: { getSessionId: () => 'owner' } };
    const input = (id, originalText = '/skill:ulw-plan', source = 'interactive', text = originalText) =>
      emit(handlers, 'input', { inputId: id, originalText, source, text }, ctx);
    const disposition = (id, disposition = 'started') => emit(handlers, 'input_disposition', { inputId: id, disposition }, ctx);
    const execute = id => readLifecycle(handlers, { type: 'tool_result', toolCallId: id, toolName: 'read', input: { path: '/skills/ulw-execute/SKILL.md' }, isError: false }, ctx);
    const check = (expected, reason, state = tracker) => {
      for (const role of ['plan-consultant', 'plan-reviewer']) assert.equal(Pu(role, state.stateFor('owner')).kind, expected, role + ': ' + reason);
    };
    emit(handlers, 'tool_result', { type: 'tool_result', toolName: 'read', input: { path: '.omo/plans/test.md' }, isError: false }, ctx);
    execute('execute-1');
    input('plan-1');
    check('deny', 'raw command is not admission');
    disposition('plan-1');
    check('allow', 'execute read then fresh original command reopens at the same timestamp');
    check('allow', 'reentry survives reload', eY({ on() {} }, { stateDir: reentryDir }));
    assert.equal(fs.existsSync(path.join(reentryDir, 'plan-executions', 'owner.json')), true, 'historical execute marker survives reentry');
    input('unrelated', 'hello'); disposition('unrelated');
    check('allow', 'sticky execute is not a new execution on unrelated input');
    execute('execute-1');
    check('allow', 'duplicate successful read does not advance epoch');
    execute('execute-2');
    check('deny', 'another execute revokes at the same timestamp');
    input('plan-1'); disposition('plan-1');
    check('deny', 'duplicate old input and disposition cannot reauthorize');
    for (const [id, original, source, text] of [
      ['transformed', 'hello', 'interactive', '/skill:ulw-plan'],
      ['extension', '/skill:ulw-plan', 'extension', '/skill:ulw-plan'],
      ['missing', undefined, 'interactive', '/skill:ulw-plan'],
      ['discussion', 'please review the plan', 'interactive', '/skill:ulw-plan'],
      ['quoted', '`/skill:ulw-plan`', 'interactive', '/skill:ulw-plan'],
      ['xml', '<skill name="ulw-plan">start</skill>', 'interactive', '/skill:ulw-plan'],
      ['arguments', '/skill:ulw-plan explain', 'interactive', '/skill:ulw-plan'],
      ['unknown-source', '/skill:ulw-plan', undefined, '/skill:ulw-plan']
    ]) {
      emit(handlers, 'input', { inputId: id, originalText: original, source, text }, ctx);
      disposition(id);
      check('deny', id + ' cannot reopen');
    }
    input('rejected'); disposition('rejected', 'rejected'); disposition('rejected');
    check('deny', 'rejected input cannot later be replayed as admitted');
    input('handled'); disposition('handled', 'handled');
    check('deny', 'handled input is not admission');
    input('stale-pending'); execute('execute-3'); disposition('stale-pending');
    check('deny', 'execute between input and admission invalidates pending reentry');
    input('plan-2', '/skill:ulw-plan', 'rpc'); disposition('plan-2', 'queued');
    check('allow', 'execute reopen execute reopen with owner RPC admission');
    input('execute-command', '/skill:ulw-execute');
    check('deny', 'unsettled execute input reserves closure before admission');
    disposition('execute-command');
    check('deny', 'genuine admitted execute command revokes');
    input('plan-3'); disposition('plan-3');
    check('allow', 'third reentry');
    disposition('execute-command');
    check('allow', 'duplicate execute disposition is idempotent');
    for (const [id, command, source, admission] of [
      ['execute-args', '/skill:ulw-execute do the work', 'interactive', 'started'],
      ['execute-slug', '/skill:ulw-execute gate-repair', 'rpc', 'queued'],
      // Bare narrative workflow commands revoke without any intervening SKILL.md read.
      ['bare-execute-plan', '/ulw-execute plan', 'interactive', 'started'],
      ['bare-execute-slug', '/ulw-execute desktop-switcher-role-taxonomy', 'rpc', 'queued'],
      ['bare-execute', '/ulw-execute', 'interactive', 'started']
    ]) {
      input(id, command, source);
      check('deny', command + ' reserves closure before admission after reopen');
      disposition(id, admission);
      check('deny', command + ' revokes after admission');
      check('deny', command + ' revocation survives reload', eY({ on() {} }, { stateDir: reentryDir }));
      input(id + '-plan-args', '/skill:ulw-plan gate-repair', source);
      disposition(id + '-plan-args', admission);
      check('deny', 'plan arguments cannot acknowledge the new execute epoch');
      input(id + '-bare-plan', '/ulw-plan', source);
      disposition(id + '-bare-plan', admission);
      check('deny', 'bare plan command cannot reopen');
      input(id + '-reopen', '/skill:ulw-plan', source);
      disposition(id + '-reopen', admission);
      check('allow', 'exact plan command reopens after execute arguments');
      disposition(id, admission);
      check('allow', 'duplicate execute-with-arguments admission is idempotent');
    }
    for (const [id, originalText, source, text] of [
      ['bare-suffix', '/ulw-execute-more plan', 'interactive', '/ulw-execute-more plan'],
      ['bare-path-suffix', '/ulw-execute/plan', 'interactive', '/ulw-execute/plan'],
      ['bare-prefixed', 'please /ulw-execute plan', 'interactive', 'please /ulw-execute plan'],
      ['bare-inline-code', '`/ulw-execute plan`', 'interactive', '`/ulw-execute plan`'],
      ['bare-quoted', '"/ulw-execute plan"', 'interactive', '"/ulw-execute plan"'],
      ['bare-fenced', '```\n/ulw-execute plan\n```', 'interactive', '```\n/ulw-execute plan\n```'],
      ['bare-transformed', 'hello', 'interactive', '/ulw-execute plan'],
      ['bare-extension', '/ulw-execute plan', 'extension', '/ulw-execute plan'],
      ['bare-missing-original', undefined, 'interactive', '/ulw-execute plan']
    ]) {
      emit(handlers, 'input', { inputId: id, originalText, source, text }, ctx);
      disposition(id);
      check('allow', id + ' is not an authentic owner execute command');
    }
    for (const rejectedDisposition of ['handled', 'rejected']) {
      const id = 'bare-execute-' + rejectedDisposition;
      input(id, '/ulw-execute plan'); disposition(id, rejectedDisposition);
      check('allow', 'bare execute requires admission, not ' + rejectedDisposition);
    }
    const requestFile = path.join(reentryDir, 'plan-requests', 'owner.json');
    const saved = fs.readFileSync(requestFile, 'utf8');
    for (const changed of ['{broken', JSON.stringify({ ...JSON.parse(saved), projectKey: 'foreign' }), JSON.stringify({ ...JSON.parse(saved), recordedAtMs: Date.now() - 2592000001 })]) {
      fs.writeFileSync(requestFile, changed);
      check('deny', 'corrupt foreign or expired request stays closed even in live tracker');
    }
    fs.writeFileSync(requestFile, saved);
    execute('execute-4');
    input('stale-writer');
    renameHook = () => externalExecute(reentryDir, 'owner', 'execute-5');
    disposition('stale-writer');
    check('deny', 'execute during stale request publication cannot be overwritten');
    input('plan-4'); disposition('plan-4');
    check('allow', 'fresh command recovers after stale writer');
    // Force another process to win the exact next ordinal before this process publishes.
    linkHook = () => externalExecute(reentryDir, 'owner', 'execute-6');
    input('colliding-input'); disposition('colliding-input');
    check('deny', 'losing input writer cannot rebase the captured epoch after EEXIST');
    input('plan-5'); disposition('plan-5');
    check('allow', 'fresh command after input publication collision');
    input('colliding-admission');
    linkHook = () => externalExecute(reentryDir, 'owner', 'execute-7');
    disposition('colliding-admission');
    check('deny', 'losing admission writer rechecks epoch after EEXIST');
    const reloadHandlers = new Map();
    const reload = eY(listen(reloadHandlers), { stateDir: reentryDir });
    emit(reloadHandlers, 'input', { inputId: 'plan-5', originalText: '/skill:ulw-plan', text: '/skill:ulw-plan', source: 'interactive' }, ctx);
    emit(reloadHandlers, 'input_disposition', { inputId: 'plan-5', disposition: 'started' }, ctx);
    check('deny', 'duplicate identity remains consumed after reload', reload);
    input('plan-6'); disposition('plan-6');
    externalExecute(reentryDir, 'owner', 'execute-7', true);
    check('allow', 'duplicate read identity remains consumed across processes');
    readLifecycle(handlers, { type: 'tool_result', toolCallId: 'failed-read', toolName: 'read', input: { path: '/skills/ulw-execute/SKILL.md' }, isError: true }, ctx);
    check('allow', 'failed execute read is not execution');
    input('fake-execute', 'hello', 'interactive', '/skill:ulw-execute'); disposition('fake-execute');
    check('allow', 'transformed execute command is not execution');
    const untouchedCtx = { sessionManager: { getSessionId: () => 'untouched' } };
    readLifecycle(handlers, { type: 'tool_result', toolCallId: 'untouched-execute', toolName: 'read', input: { path: '/skills/ulw-execute/SKILL.md' }, isError: false }, untouchedCtx);
    emit(handlers, 'input', { inputId: 'untouched-plan', originalText: '/skill:ulw-plan', text: '/skill:ulw-plan', source: 'interactive' }, untouchedCtx);
    emit(handlers, 'input_disposition', { inputId: 'untouched-plan', disposition: 'started' }, untouchedCtx);
    assert.equal(Pu('plan-reviewer', tracker.stateFor('untouched')).kind, 'deny', 'epoch acknowledgement cannot replace artifact guard');
    const epochFile = path.join(reentryDir, 'plan-epochs', 'owner', '1.json');
    const epochBytes = fs.readFileSync(epochFile, 'utf8');
    for (const changed of ['{broken', JSON.stringify({ ...JSON.parse(epochBytes), projectKey: 'foreign' }), JSON.stringify({ ...JSON.parse(epochBytes), sessionId: 'foreign' })]) {
      fs.writeFileSync(epochFile, changed);
      check('deny', 'corrupt or foreign epoch journal fails closed');
    }
    fs.writeFileSync(epochFile, epochBytes);
    execute('execute-8');
    input('failed-reentry-save');
    renameHook = () => { const error = new Error('injected reentry rename refusal'); error.code = 'EPERM'; throw error; };
    assert.throws(() => disposition('failed-reentry-save'), { code: 'EPERM' });
    check('deny', 'failed reentry publication reports error and stays closed');
    disposition('failed-reentry-save');
    check('deny', 'duplicate callback cannot turn failed publication into allow');
    input('plan-7'); disposition('plan-7');
    check('allow', 'only fresh admitted input recovers from failed publication');
  } finally {
    Date.now = realNow;
    fs.rmSync(reentryDir, { recursive: true, force: true });
  }
  // Real user provenance per the senpi InputSource contract: the interactive host defaults to
  // "interactive" (agent-session send paths fall back to it) and an RPC client delivers "rpc"
  // (prompt/steer/followUp). There is no "user" source in the engine; "extension" is programmatic
  // injection and is the only rejected source, so every genuine emission below uses these two values.
  for (const userSource of ['interactive', 'rpc']) for (const [text, allowed] of cases) {
    const handlers = new Map();
    const pi = listen(handlers);
    const stateDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-request-'));
    const state = eY(pi, { stateDir });
    const ctx = { sessionManager: { getSessionId: () => 'fixture' } };
    try {
      emit(handlers, 'tool_result', { type: 'tool_result', toolName: 'read', input: { path: '.omo/plans/test.md' }, isError: false }, ctx);
      emit(handlers, 'input', { text, source: userSource }, ctx);
      const view = state.stateFor('fixture');
      assert.deepEqual(view.planArtifactReferences().map(ref => ref.path), ['.omo/plans/test.md'], userSource + ' ' + text + ': matching plan must be touched');
      assert.equal(Pu('plan-consultant', view).kind, allowed ? 'allow' : 'deny', userSource + ' ' + text + ': consultant');
      assert.equal(Pu('plan-reviewer', view).kind, allowed ? 'allow' : 'deny', userSource + ' ' + text + ': reviewer');
      if (!allowed) {
        assert.equal(view.hasPlanArtifact(), true, text + ': live plan touch present');
        assert.equal(view.hasUserRequested('ulw-plan'), false, text + ': live request absent');
        emit(handlers, 'session_shutdown', {}, ctx);
        const negativeView = eY({ on() {} }, { stateDir }).stateFor('fixture');
        assert.equal(negativeView.hasPlanArtifact(), true, text + ': plan touch remains available after reload');
        assert.equal(negativeView.hasUserRequested('ulw-plan'), false, text + ': no durable user request');
        assert.equal(Pu('plan-reviewer', negativeView).kind, 'deny', text + ': no request after reload');
      }
      if (allowed) {
        const provenanceStateDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-provenance-'));
        try {
          const provenanceHandlers = new Map();
          const provenance = eY(listen(provenanceHandlers), { stateDir: provenanceStateDir });
          // Programmatic extension input is the only rejected source: a fully valid plan request and
          // an /skill:ulw-execute command from an extension leave no marker and no ledger behind.
          emit(provenanceHandlers, 'input', { text, source: 'extension' }, ctx);
          emit(provenanceHandlers, 'input', { text: '/skill:ulw-execute', source: 'extension' }, ctx);
          assert.equal(provenance.stateFor('fixture').hasUserRequested('ulw-plan'), false, 'extension input cannot request a plan');
          assert.equal(provenance.stateFor('fixture').hasInvoked('ulw-execute'), false, 'extension input cannot invoke execute');
          assert.equal(fs.existsSync(path.join(provenanceStateDir, 'plan-requests')), false, 'extension input cannot create a request ledger');
          assert.equal(fs.existsSync(path.join(provenanceStateDir, 'plan-executions')), false, 'extension input cannot create an execute ledger');
        } finally { fs.rmSync(provenanceStateDir, { recursive: true, force: true }); }
        emit(handlers, 'session_shutdown', {}, ctx);
        const reloaded = eY({ on() {} }, { stateDir });
        assert.equal(Pu('plan-reviewer', reloaded.stateFor('fixture')).kind, 'allow', 'same-session second review after shutdown and tracker recreation');
        assert.equal(Pu('plan-reviewer', reloaded.stateFor('other-session')).kind, 'deny', 'no cross-session request reuse');
        const requestFile = path.join(stateDir, 'plan-requests', 'fixture.json');
        const requestBytes = fs.readFileSync(requestFile, 'utf8');
        const otherProject = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-other-project-'));
        try {
          fs.mkdirSync(path.join(otherProject, 'plan-requests'));
          fs.copyFileSync(requestFile, path.join(otherProject, 'plan-requests', 'fixture.json'));
          const otherHandlers = new Map();
          const other = eY(listen(otherHandlers), { stateDir: otherProject });
          emit(otherHandlers, 'tool_result', { type: 'tool_result', toolName: 'read', input: { path: '.omo/plans/test.md' }, isError: false }, ctx);
          assert.equal(Pu('plan-reviewer', other.stateFor('fixture')).kind, 'deny', 'foreign project request denied despite plan touch');
        } finally { fs.rmSync(otherProject, { recursive: true, force: true }); }
        const noPlan = eY({ on() {} }, { stateDir });
        assert.equal(Pu('plan-reviewer', noPlan.stateFor('fixture')).kind, 'allow', 'persisted plan touch is available after reload');
        fs.writeFileSync(requestFile, '{broken');
        assert.equal(reloaded.stateFor('fixture').hasPlanArtifact(), true, 'corrupt request: plan remains touched');
        assert.equal(reloaded.stateFor('fixture').hasUserRequested('ulw-plan'), false, 'corrupt request not authorized');
        assert.equal(Pu('plan-reviewer', reloaded.stateFor('fixture')).kind, 'deny', 'corrupt request denied');
        fs.writeFileSync(requestFile, JSON.stringify({ ...JSON.parse(requestBytes), recordedAtMs: Date.now() - 2592000001 }));
        assert.equal(reloaded.stateFor('fixture').hasPlanArtifact(), true, 'stale request: plan remains touched');
        assert.equal(reloaded.stateFor('fixture').hasUserRequested('ulw-plan'), false, 'stale request not authorized');
        assert.equal(Pu('plan-reviewer', reloaded.stateFor('fixture')).kind, 'deny', 'stale request denied');
        fs.writeFileSync(requestFile, requestBytes);
        const nativeHandlers = new Map();
        const nativeTracker = eY(listen(nativeHandlers), { stateDir });
        assert.equal(Pu('plan-reviewer', nativeTracker.stateFor('fixture')).kind, 'allow', 'pre-execute native gate accepts touched plan');
        readLifecycle(nativeHandlers, { type: 'tool_result', toolName: 'read', input: { path: '/skills/ulw-execute/SKILL.md' }, isError: false }, ctx);
        assert.equal(nativeTracker.stateFor('fixture').hasInvoked('ulw-execute'), true, 'native skill read invokes execute');
        assert.equal(Pu('plan-reviewer', eY({ on() {} }, { stateDir }).stateFor('fixture')).kind, 'deny', 'skill read forbids review after reload with plan intact');
        emit(nativeHandlers, 'input', { text: '/skill:ulw-execute', source: userSource }, ctx);
        const committedExecute = fs.readFileSync(requestFile, 'utf8');
        assert.equal(JSON.parse(committedExecute).executed, true, 'committed ledger contains executed:true before rename refusal');
        renameHook = () => { const error = new Error('injected rename refusal'); error.code = 'EPERM'; throw error; };
        assert.throws(() => emit(nativeHandlers, 'input', { text, source: userSource }, ctx), { code: 'EPERM' });
        assert.equal(fs.readFileSync(requestFile, 'utf8'), committedExecute, 'failed rename preserves committed executed:true');
        assert.equal(eY({ on() {} }, { stateDir }).stateFor('fixture').hasInvoked('ulw-execute'), true, 'failed rename cannot lose execute');
        assert.equal(Pu('plan-reviewer', eY({ on() {} }, { stateDir }).stateFor('fixture')).kind, 'deny', 'failed rename remains forbidden');
        const raceDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-writers-'));
        try {
          const staleHandlers = new Map(), writerHandlers = new Map();
          eY(listen(staleHandlers), { stateDir: raceDir });
          eY(listen(writerHandlers), { stateDir: raceDir });
          emit(staleHandlers, 'tool_result', { type: 'tool_result', toolName: 'read', input: { path: '.omo/plans/test.md' }, isError: false }, ctx);
          emit(staleHandlers, 'input', { text, source: userSource }, ctx);
          const raceFile = path.join(raceDir, 'plan-requests', 'fixture.json');
          assert.equal(JSON.parse(fs.readFileSync(raceFile, 'utf8')).executed, false, 'race starts before execute');
          renameHook = () => emit(writerHandlers, 'input', { text: '/skill:ulw-execute', source: userSource }, ctx);
          emit(staleHandlers, 'input', { text, source: userSource }, ctx);
          assert.equal(JSON.parse(fs.readFileSync(raceFile, 'utf8')).executed, false, 'forced stale writer overwrote ledger flag');
          const raceView = eY({ on() {} }, { stateDir: raceDir }).stateFor('fixture');
          assert.equal(raceView.hasPlanArtifact(), true, 'race denial has plan touch');
          assert.equal(raceView.hasUserRequested('ulw-plan'), true, 'race denial has user request');
          assert.equal(raceView.hasInvoked('ulw-execute'), true, 'immutable execute marker survives stale writer');
          assert.equal(Pu('plan-reviewer', raceView).kind, 'deny', 'stale writer cannot bypass execute');
        } finally { fs.rmSync(raceDir, { recursive: true, force: true }); }
        const untouched = eY({ on() {} }, { stateDir });
        assert.equal(Pu('plan-reviewer', untouched.stateFor('untouched')).kind, 'deny', 'a request cannot replace a plan artifact');
        emit(handlers, 'input', { text: '/skill:ulw-execute', source: userSource }, ctx);
        assert.equal(Pu('plan-reviewer', view).kind, 'deny', 'ulw-execute forbids review after a plan request');
        const executeView = eY({ on() {} }, { stateDir }).stateFor('fixture');
        assert.equal(executeView.hasPlanArtifact(), true, 'execute-after still has touched plan');
        assert.equal(executeView.hasInvoked('ulw-execute'), true, 'execute-after predicate persisted');
        assert.equal(Pu('plan-reviewer', executeView).kind, 'deny', 'ulw-execute stays forbidden after reload');
        const beforeExecuteDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'gate-execute-first-'));
        try {
          const beforeHandlers = new Map();
          eY(listen(beforeHandlers), { stateDir: beforeExecuteDir });
          emit(beforeHandlers, 'input', { text: '/skill:ulw-execute', source: userSource }, ctx);
          const afterHandlers = new Map();
          const after = eY(listen(afterHandlers), { stateDir: beforeExecuteDir });
          emit(afterHandlers, 'tool_result', { type: 'tool_result', toolName: 'read', input: { path: '.omo/plans/test.md' }, isError: false }, ctx);
          emit(afterHandlers, 'input', { text, source: userSource }, ctx);
          assert.equal(Pu('plan-reviewer', after.stateFor('fixture')).kind, 'deny', 'execute before request remains forbidden after reload');
        } finally { fs.rmSync(beforeExecuteDir, { recursive: true, force: true }); }
        fs.rmSync(path.join(stateDir, 'plan-touches'), { recursive: true, force: true });
        const withoutPlan = eY({ on() {} }, { stateDir }).stateFor('fixture');
        assert.equal(withoutPlan.hasPlanArtifact(), false, 'removed plan touch absent');
        assert.equal(Pu('plan-reviewer', withoutPlan).kind, 'deny', 'request without plan touch denied');
      }
    } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
  }
} else {
  for (const auditCase of auditCases) test('slot-4 audit ' + auditCase, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', '--audit-case', auditCase], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr || child.stdout || String(child.error));
  });
  test('beta.88 slot-4 input and native reviewer gate in a fresh process', () => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}
