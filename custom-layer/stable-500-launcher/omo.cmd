@rem R21 memory-rollback-5.1.38-r1 overlay; active for NEW launches; earlier comments are historical.
@rem R21 CUTOVER pins: omo-ai 5.1.38 / senpi 2026.10.19; ACTIVE after verified byte-preserving activation; earlier comments below are historical.
@echo off
rem ===========================================================================
rem omo-memory-selector-candidate-r5 (5.1.4 CUTOVER 2026-09-30: stock 5.1.4 plugin)
rem R5 vs R4: version pair re-pinned to omo-ai 5.1.4 / senpi 2026.9.29-5. Install used
rem "bun add -g omo-ai@5.1.4" with HOME corrected to the real profile (a first run with
rem the lane HOME had landed 5.1.4 in <lane>\home\.bun - removed as debris); bun blocked
rem postinstall again, so bin/senpi-patch.mjs was re-run with the pinned node (stamp 5.1.4).
rem omo-memory-selector-candidate-r4 (PLAN B CUTOVER 2026-09-29: stock 5.1.1 plugin)
rem R4 vs R3: version pair re-pinned to omo-ai 5.1.1 / senpi 2026.9.29 (postinstall
rem re-run with pinned node after bun blocked it); the direct branch now loads the
rem STOCK omo-ai\plugin. Memory-selector correction PARKED - corrected source
rem preserved at .omo-stable-500\src-oh-my-openagent-5.0.0-preserved; re-implant
rem later via a rebuild if wanted. The r3 header below is retained for lineage and
rem describes the superseded r2-staging wiring.
rem ===========================================================================
rem omo-memory-selector-candidate-r3 (STAGED SUCCESSOR - NOT LIVE, NOT ACTIVE)
rem Successor to staging/omo-memory-selector-candidate-r2.cmd (R2 preserved
rem receipt; see LAUNCHER-CANDIDATE-R2.md for what changed and why).
rem Loads exactly ONE corrected OMO plugin from:
rem   C:\Users\USER\.omo-stable-500\staging\memory-selector-v5.0.0-r2
rem with the live lane's full discovered extensions (incl. the owner's
rem omo-model-tuning.ts role tuning) kept loaded.
rem
rem Ownership basis (loader evidence, not token count):
rem Project LAUNCHER-CANDIDATE-QA.md records ONE real start (exit 0) of the
rem discovery-enabled predecessor: exactly ONE OMO owner at r2
rem extensions/omo.js, ZERO stock owners, ZERO loader errors/duplicates, and
rem all SIX live-home user extensions loaded (diff/files/prompt-url-widget/
rem tps/omo-model-tuning.ts/test shim) for 52 total entries. R5's isolated
rem empty-home no-extensions probe is consistent but NOT this wrapper's basis.
rem A bare extension token never proved ownership; the QA loader maps did.
rem
rem Routing (first token of always-available args):
rem   STOCK helpers (delegated unchanged to the pinned installed entry; they
rem   never need the staged payload):
rem     daemon doctor setup ulw-loop update install remove list config auth
rem     app-server host, plus single-arg version, -v, help, -h, list-tips.
rem   DIRECT (pinned Senpi bundle CLI, single r2 extension token):
rem     everything else, including interactive launch, print, list-models.
rem
rem Contract:
rem   * Node is pinned, never taken from PATH.
rem   * Inherited state-root overrides outside this lane are refused with
rem     exit 2 BEFORE any product, engine, or helper process starts. (The
rem     validator itself runs pinned Node -e; "any child process" in older
rem     comments overstated this. Inherited from the live wrapper.)
rem   * Provider and credential environment is left untouched: only the lane
rem     state roots named below are inspected or cleared.
rem   * The staged-only checks (r2 entry, Senpi CLI, engine prep/version
rem     gate) run ONLY on the direct branch, AFTER the stock-branch decision,
rem     so a missing staged payload can never break a stock helper.
rem   * Direct-branch re-entry (OMO_BIN) points at the candidate-aware
rem     staging/omo-memory-selector-entry-r2.mjs, never at stock. Consumers
rem     traced: senpi engine and bundled extensions read no OMO_BIN; the
rem     r2 give-me-tips skill documents the node launcher list-tips usage.
rem   * Direct branch fails closed (exit 2) when the installed engine stamp
rem     or pinned versions no longer match the validated pair
rem     (omo-ai 5.0.0 / senpi 2026.9.26); it never writes the install.
rem   * Normal HOME writes are EXPECTED on uninstrumented startup (QA guard
rem     blocked 48: quarantine rm, migration lock, models-store lock dirs);
rem     this wrapper is not a read-only startup guarantee. The quarantine
rem     target was absent on re-inspection (see R2 doc); its presence would
rem     be a separate activation blocker, never auto-removed here.
rem   * R3 change vs R2: OMO_BIN now points at entry-r3, which classifies
rem     stock vs direct argv itself (same first-token rules as this file)
rem     BEFORE any staged prerequisite, and spawns stock helpers via the
rem     pinned installed entry. No console hiding on either spawn.
rem ===========================================================================
setlocal EnableExtensions DisableDelayedExpansion

set "OMO_STABLE_ROOT=C:\Users\USER\.omo-stable-500"
set "OMO_STABLE_NODE=C:\Users\USER\AppData\Roaming\npm\node.exe"
set "OMO_STABLE_ENTRY=C:\Users\USER\.omo-stable-500\staging\memory-rollback-5.1.38-r1\package\bin\omo.js"
set "OMO_STABLE_HOME=%OMO_STABLE_ROOT%\home"
set "OMO_STABLE_AGENT=%OMO_STABLE_HOME%\.omo\agent"
set "OMO_STABLE_R2=C:\Users\USER\.omo-stable-500\staging\memory-selector-v5.0.0-r2"
set "OMO_STABLE_PLUGIN=C:\Users\USER\.omo-stable-500\staging\memory-rollback-5.1.38-r1\package\plugin"
set "OMO_STABLE_R2_ENTRY=%OMO_STABLE_R2%\extensions\omo.js"
set "OMO_STABLE_SENPI_BUNDLE=C:\Users\USER\.bun\install\global\node_modules\@code-yeongyu\senpi\dist\bundle\cli.js"
set "OMO_STABLE_SENPI_FALLBACK=C:\Users\USER\.bun\install\global\node_modules\@code-yeongyu\senpi\dist\cli.js"
set "OMO_STABLE_SENPI_BIN_DIR=C:\Users\USER\.bun\install\global\node_modules\.bin"
set "OMO_STABLE_REENTRY=C:\Users\USER\.omo-stable-500\staging\omo-memory-selector-entry-r21.mjs"
set "OMO_STABLE_PINNED_OMO=5.1.38"
set "OMO_STABLE_PINNED_SENPI=2026.10.19"

if not exist "%OMO_STABLE_NODE%" (
  echo OMO_STABLE_PINNED_NODE_MISSING %OMO_STABLE_NODE% 1>&2
  endlocal & exit /b 2
)
if not exist "C:\Users\USER\.bun\install\global\node_modules\omo-ai\bin\omo.js" (
  echo OMO_STABLE_ENTRY_MISSING %OMO_STABLE_ENTRY% 1>&2
  endlocal & exit /b 2
)

rem --- inherited state roots: anything outside this lane is a refusal ---------
set "OMO_STABLE_GUARDED=OMO_CODING_AGENT_DIR,SENPI_CODING_AGENT_DIR,PI_CODING_AGENT_DIR,OMO_CODING_AGENT_SESSION_DIR,SENPI_CODING_AGENT_SESSION_DIR,OMO_LSP_DAEMON_DIR,OMO_LSP_DAEMON_CLI,OMO_PACKAGE_DIR,SENPI_PACKAGE_DIR,PI_PACKAGE_DIR"
"%OMO_STABLE_NODE%" -e "const p=require('node:path');const lane=p.resolve(process.argv[1]).toLowerCase();const bad=process.argv[2].split(',').filter((n)=>{const v=process.env[n];if(!v)return false;const a=p.resolve(v).toLowerCase();return a!==lane&&!a.startsWith(lane+p.sep);});if(bad.length){for(const n of bad)console.error('OMO_STABLE_REFUSED_FOREIGN_STATE_ROOT '+n+'='+process.env[n]);console.error('omo-stable-500: every state root for this lane must resolve inside '+process.argv[1]);process.exit(2);}" "%OMO_STABLE_ROOT%" "%OMO_STABLE_GUARDED%"
if errorlevel 1 (
  endlocal & exit /b 2
)

rem --- other-lane session identity, daemon build and package/SDK roots cleared --
set "OMO_LSP_DAEMON_VERSION="
set "PI_SESSION_FILE="
set "PI_SESSION_ID="
set "PI_SESSION_CWD="
set "OMO_AGENT_TOOLKIT_SDK_ROOT="
set "OMO_DAG_SDK_ROOT="
set "OMO_PACKAGE_DIR="
set "SENPI_PACKAGE_DIR="
set "PI_PACKAGE_DIR="

rem --- force this lane's profile and engine state -----------------------------
set "HOME=%OMO_STABLE_HOME%"
set "USERPROFILE=%OMO_STABLE_HOME%"
set "OMO_CODING_AGENT_DIR=%OMO_STABLE_AGENT%"
set "SENPI_CODING_AGENT_DIR=%OMO_STABLE_AGENT%"
set "PI_CODING_AGENT_DIR=%OMO_STABLE_AGENT%"
set "OMO_RUNTIME=node"
if not exist "%OMO_STABLE_AGENT%" mkdir "%OMO_STABLE_AGENT%" >nul 2>nul

if "%~1"=="setup" goto :upstream_maintenance
if "%~1"=="update" goto :upstream_maintenance
if "%~1"=="install" goto :upstream_maintenance
if "%~1"=="remove" goto :upstream_maintenance
if "%~1"=="list" goto :upstream_maintenance
if "%~1"=="config" goto :upstream_maintenance
if "%~1"=="auth" goto :upstream_maintenance
if "%~1"=="--version" if "%~2"=="" goto :upstream_maintenance
if "%~1"=="-v" if "%~2"=="" goto :upstream_maintenance
if "%~1"=="--help" if "%~2"=="" goto :upstream_maintenance
if "%~1"=="-h" if "%~2"=="" goto :upstream_maintenance
if "%~1"=="--list-tips" if "%~2"=="" goto :upstream_maintenance
if not defined UV_THREADPOOL_SIZE set "UV_THREADPOOL_SIZE=16" & rem D4          
"%OMO_STABLE_NODE%" -e "const f='C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/gate.mjs';if(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(f)).digest('hex')!=='5c74e89b8b47f9108d5a974f3b41960ff7c3896d25cc46d8d8663b188a02479c'){console.error('MEMORY_OVERLAY_GATE_DIGEST');process.exit(2);}import(require('node:url').pathToFileURL(f).href).then(m=>m.verifyPayload('15177e17f64e9a7f8bdcc5abaf3d8aacfc6a6a39d01bf7894ac4039221d7a177')).catch(e=>{console.error('MEMORY_OVERLAY_GATE '+e.message);process.exitCode=2;});"
if errorlevel 1 (
  endlocal & exit /b 2
)
rem --- stock-owned maintenance and special commands: delegate unchanged -------
rem NOTE: no staged-payload check precedes this decision (reviewer M3). A
rem missing r2 must never break a stock helper that does not use it.
if "%~1"=="daemon" goto :stock
if "%~1"=="doctor" goto :stock
if "%~1"=="setup" goto :stock
if "%~1"=="ulw-loop" goto :stock
if "%~1"=="update" goto :stock
if "%~1"=="install" goto :stock
if "%~1"=="remove" goto :stock
if "%~1"=="list" goto :stock
if "%~1"=="config" goto :stock
if "%~1"=="auth" goto :stock
if "%~1"=="app-server" goto :stock
if "%~1"=="host" goto :stock
if "%~1"=="--version" if "%~2"=="" goto :stock
if "%~1"=="-v" if "%~2"=="" goto :stock
if "%~1"=="--help" if "%~2"=="" goto :stock
if "%~1"=="-h" if "%~2"=="" goto :stock
if "%~1"=="--list-tips" if "%~2"=="" goto :stock

rem --- direct branch: staged-only prerequisites live here, after routing -----
if not exist "%OMO_STABLE_PLUGIN%\extensions\omo.js" (
  echo OMO_STABLE_STOCK_PLUGIN_MISSING %OMO_STABLE_PLUGIN% 1>&2
  endlocal & exit /b 2
)
set "OMO_STABLE_SENPI=%OMO_STABLE_SENPI_BUNDLE%"
if not exist "%OMO_STABLE_SENPI%" set "OMO_STABLE_SENPI=%OMO_STABLE_SENPI_FALLBACK%"
if not exist "%OMO_STABLE_SENPI%" (
  echo OMO_STABLE_SENPI_CLI_MISSING %OMO_STABLE_SENPI% 1>&2
  endlocal & exit /b 2
)
if not exist "%OMO_STABLE_REENTRY%" (
  echo OMO_STABLE_REENTRY_MISSING %OMO_STABLE_REENTRY% 1>&2
  endlocal & exit /b 2
)
rem Read-only engine prep/version gate: fail closed, never writes (M4).
"%OMO_STABLE_NODE%" -e "const fs=require('node:fs');const fail=(m)=>{console.error('OMO_STABLE_DIRECT_PREREQ '+m);process.exit(2);};let omo,senpi;try{omo=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version;}catch(e){fail('installed omo-ai manifest unreadable: '+e.message);}try{senpi=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).version;}catch(e){fail('installed senpi manifest unreadable: '+e.message);}if(omo!==process.argv[5])fail('installed omo-ai '+omo+' != validated '+process.argv[5]);if(senpi!==process.argv[6])fail('installed senpi '+senpi+' != validated '+process.argv[6]);let stamp;try{stamp=fs.readFileSync(process.argv[3],'utf8').trim();}catch(e){fail('engine prepared stamp unreadable: '+e.message);}if(stamp!==omo)fail('engine stamp '+JSON.stringify(stamp)+' != installed '+omo);for(const f of [process.argv[4],process.argv[7]])if(!fs.existsSync(f))fail('missing '+f);" "C:\Users\USER\.bun\install\global\node_modules\omo-ai\package.json" "C:\Users\USER\.bun\install\global\node_modules\@code-yeongyu\senpi\package.json" "C:\Users\USER\.bun\install\global\node_modules\@code-yeongyu\senpi\.omo-engine-prepared" "%OMO_STABLE_SENPI%" "%OMO_STABLE_PINNED_OMO%" "%OMO_STABLE_PINNED_SENPI%" "C:\Users\USER\.bun\install\global\node_modules\@code-yeongyu\senpi\dist\core\brand.js"
if errorlevel 1 (
  endlocal & exit /b 2
)

rem --- installed stock plugin plus live-home discovered extras -----
rem Discovery stays ON (QA-proven): the stock plugin owner plus the six live-home user
rem extensions (incl. omo-model-tuning.ts) all loaded with zero conflicts.
rem Single-ownership is loader evidence, not a token count.
set "SENPI_BIN="
set "OMO_BIN="
set "OMO_STABLE_BRAND={"name":"OmO","command":"omo","displayVersion":"5.1.38","configDir":".omo","flatLayout":false,"envPrefix":"OMO","userAgent":"omo","originator":"omo","changelog":{"path":"C:\\Users\\USER\\.bun\\install\\global\\node_modules\\omo-ai\\CHANGELOG.md","version":"5.1.38"},"update":{"packageName":"omo-ai","distTag":"latest","command":"bun add -g omo-ai","changelogUrl":"https://github.com/code-yeongyu/oh-my-openagent/releases"}}"
set "SENPI_BRAND=%OMO_STABLE_BRAND%"
set "OMO_NATIVE=1"
set "SENPI_RUNTIME=node"
set "OMO_BIN=%OMO_STABLE_REENTRY%"
if exist "%OMO_STABLE_SENPI_BIN_DIR%\senpi.cmd" set "SENPI_BIN=%OMO_STABLE_SENPI_BIN_DIR%\senpi.cmd"
set "PATH=%OMO_STABLE_SENPI_BIN_DIR%;%PATH%"
"%OMO_STABLE_NODE%" "%OMO_STABLE_SENPI%" --extension "%OMO_STABLE_PLUGIN%" %*
set "OMO_STABLE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %OMO_STABLE_EXIT%

:stock
rem --- delegate to the pinned installed entry only (stock plugin/behaviour) ---
"%OMO_STABLE_NODE%" "%OMO_STABLE_ENTRY%" %*
set "OMO_STABLE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %OMO_STABLE_EXIT%

:upstream_maintenance
rem Read-only metadata and package management retain the original package root.
"%OMO_STABLE_NODE%" "C:\Users\USER\.bun\install\global\node_modules\omo-ai\bin\omo.js" %*
set "OMO_STABLE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %OMO_STABLE_EXIT%
