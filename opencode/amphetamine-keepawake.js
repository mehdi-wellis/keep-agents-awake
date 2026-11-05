// Keeps an Amphetamine session running while any OpenCode session is working, so agents carry on with the lid closed.
// Setup guide: see the README in the keep-agents-awake repo.
// Log: ~/Library/Logs/opencode-amphetamine.log  To turn it off: delete this file.
import { execFile, spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const TICK_MS = 15_000
const GRACE_MS = 30_000 // Stay awake this long after agents stop, so a brief gap doesn't end the session.
const MIN_BATTERY_PERCENT = 20
const SESSION_HOURS = 24 // Amphetamine ends the session itself by then, even if everything here has died.
const SETTLE_MS = 10_000 // Amphetamine changes SleepDisabled a few seconds after a session starts or ends.
const MAX_API_FAILURES = 8

const OTHER_AGENT_FRESH_MS = 60_000

const LOG_FILE = join(homedir(), "Library/Logs/opencode-amphetamine.log")
// Records the watcher process while agents are working.
const HOLD_FILE = join(homedir(), ".local/state/opencode-amphetamine/hold.json")
// Shared with the Claude Code setup, so neither switches Amphetamine off while the other is still working.
const SHARED_DIR = join(homedir(), ".local/state/keep-agents-awake")
const OWNED_FILE = join(SHARED_DIR, "owned") // Exists while the running Amphetamine session is one we started.
const WORKING_FILE = join(SHARED_DIR, "opencode-working") // Touched on every check while agents are working.
const CLAUDE_WORKING_FILE = join(SHARED_DIR, "claude-working")

// macOS only sleeps at the moment the lid closes, so a Mac whose work ends later stays awake unless told to sleep.
// Skipped when an external display is in use, because then the closed lid is deliberate.
const SLEEP_IF_LID_CLOSED = `
case "$(/usr/sbin/ioreg -r -k AppleClamshellState -d 1)" in
  *'"AppleClamshellState" = Yes'*) ;;
  *) exit 0 ;;
esac
displays=$(/usr/sbin/system_profiler SPDisplaysDataType)
[ -n "$displays" ] || exit 0
shown=$(printf '%s\\n' "$displays" | /usr/bin/grep -c 'Resolution:')
internal=$(printf '%s\\n' "$displays" | /usr/bin/grep -c 'Connection Type: Internal')
[ "$shown" -gt "$internal" ] && exit 0
exec /usr/bin/pmset sleepnow
`

// One server hosts one plugin instance per project, so every instance shares this state and a single timer.
const KEY = Symbol.for("opencode.amphetamine-keepawake")
const S = (globalThis[KEY] ??= {
  instances: new Set(),
  timer: undefined,
  unloadTimer: undefined,
  ticking: false,
  holding: false,
  startedAt: 0,
  lastWanted: 0,
  failures: 0,
  lastReason: "",
})

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(message) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging must never stop the plugin.
  }
}

// Logs a reason for not holding only when it changes, not on every tick.
function logOnce(reason) {
  if (reason !== S.lastReason) log(reason)
  S.lastReason = reason
}

const run = (file, args, timeout = 10_000) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout }, (error, stdout) =>
      resolve({ ok: !error, out: String(stdout ?? "").trim(), error: error?.message }),
    )
  })

const amphetamine = (command) => run("/usr/bin/osascript", ["-e", `tell application "Amphetamine" to ${command}`])
const setSleepDisabled = (value) => run("/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", value])

function claudeCodeIsWorking() {
  const modified = statSync(CLAUDE_WORKING_FILE, { throwIfNoEntry: false })?.mtimeMs ?? 0
  return Date.now() - modified < OTHER_AGENT_FRESH_MS
}

async function sleepDisabled() {
  return /SleepDisabled\s+1/.test((await run("/usr/bin/pmset", ["-g"])).out)
}

async function battery() {
  const { out } = await run("/usr/bin/pmset", ["-g", "batt"])
  return { percent: Number(/(\d+)%/.exec(out)?.[1] ?? 100), discharging: /Battery Power/.test(out) }
}

// The plugin context has no active-session list and no forms, so this goes through `opencode api`, using the binary
// that's running this server. It keeps working when an OpenCode update changes that binary's path.
async function api(path) {
  const result = await run(process.execPath, ["api", "get", path])
  if (!result.ok) throw new Error(result.error)
  const body = JSON.parse(result.out)
  return body.data ?? body
}

async function activeSessions() {
  try {
    const sessions = Object.keys(await api("/api/session/active"))
    S.failures = 0
    return sessions
  } catch (error) {
    S.failures += 1
    if (S.failures === 1) log(`could not list active sessions: ${error?.message ?? error}`)
    return S.failures >= MAX_API_FAILURES ? [] : undefined
  }
}

async function waitingForYou(id) {
  for (const path of [`/api/session/${id}/permission`, `/api/session/${id}/form`]) {
    const pending = await api(path).catch(() => [])
    if (pending.length) return true
  }
  return false
}

// The active list says "running" even while an agent is only waiting for your reply, so those sessions are taken out.
// A parent also says "running" while its subagent waits for you, so it's taken out along with the subagent.
async function workingSessions() {
  const active = await activeSessions()
  if (active === undefined) return undefined
  const working = new Set(active)
  for (const id of active) {
    if (!(await waitingForYou(id))) continue
    for (let session = id; session; session = (await api(`/api/session/${session}`).catch(() => undefined))?.parentID) {
      working.delete(session)
    }
  }
  return { active, working: [...working] }
}

function readHold() {
  try {
    return JSON.parse(readFileSync(HOLD_FILE, "utf8"))
  } catch {
    return undefined
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// A separate process, so that a crashed server can't leave the Mac awake. It waits before acting so that a server
// restart can take the session over instead.
function startWatcher() {
  const script = `
while kill -0 ${process.pid} 2>/dev/null; do sleep 15; done
sleep 45
[ -f "$1" ] || exit 0
rm -f "$1" "$3"
[ -f "$4" ] && [ $(($(date +%s) - $(/usr/bin/stat -f %m "$4"))) -lt ${OTHER_AGENT_FRESH_MS / 1000} ] && exit 0
[ -f "$2" ] || exit 0
/usr/bin/osascript -e 'tell application "Amphetamine" to end session'
rm -f "$2"
sleep 10
${SLEEP_IF_LID_CLOSED}`
  const args = [HOLD_FILE, OWNED_FILE, WORKING_FILE, CLAUDE_WORKING_FILE]
  const watcher = spawn("/bin/sh", ["-c", script, "amphetamine-keepawake-watcher", ...args], {
    detached: true,
    stdio: "ignore",
  })
  watcher.unref()
  mkdirSync(dirname(HOLD_FILE), { recursive: true })
  writeFileSync(HOLD_FILE, JSON.stringify({ serverPid: process.pid, watcherPid: watcher.pid }))
}

function stopWatcher() {
  const hold = readHold()
  if (hold?.watcherPid && isAlive(hold.watcherPid)) process.kill(hold.watcherPid)
  rmSync(HOLD_FILE, { force: true })
}

// After a server restart the old watcher is still counting down, so this takes over from it.
function adoptPriorHold() {
  const hold = readHold()
  if (!hold || hold.serverPid === process.pid) return
  if (!isAlive(hold.watcherPid)) return rmSync(HOLD_FILE, { force: true })
  stopWatcher()
  Object.assign(S, { holding: true, startedAt: Date.now(), lastWanted: Date.now() })
  startWatcher()
  log("took over the Amphetamine session from the previous OpenCode server")
}

async function keepSleepDisabled() {
  if (Date.now() - S.startedAt < SETTLE_MS || (await sleepDisabled())) return
  // Respect "Allow system sleep when display is closed" if it's been turned back on.
  if ((await amphetamine("closed display mode enabled")).out !== "true") {
    return logOnce("Closed-Display Mode is off in Amphetamine, so the Mac will sleep when the lid closes")
  }
  const result = await setSleepDisabled("1")
  log(result.ok ? "SleepDisabled had dropped to 0; set it back to 1" : `could not restore SleepDisabled: ${result.error}`)
}

async function hold() {
  S.lastWanted = Date.now()
  writeFileSync(WORKING_FILE, "")
  const session = await amphetamine("session is active")
  if (!session.ok) return logOnce(`could not reach Amphetamine: ${session.error}`)

  if (session.out === "true") {
    if (!S.holding) {
      Object.assign(S, { holding: true, startedAt: Date.now() })
      startWatcher()
      log(`agents running; Amphetamine is already on${existsSync(OWNED_FILE) ? "" : " and yours, so it will be left alone"}`)
    }
    return keepSleepDisabled()
  }

  // Only reached with no session running. Starting one over a running session breaks Closed-Display Mode.
  stopWatcher()
  const started = await amphetamine(
    `start new session with options {duration:${SESSION_HOURS}, interval:hours, displaySleepAllowed:true}`,
  )
  if (!started.ok) return logOnce(`could not start an Amphetamine session: ${started.error}`)
  writeFileSync(OWNED_FILE, "")
  Object.assign(S, { holding: true, startedAt: Date.now(), lastReason: "" })
  startWatcher()
  log("agents running; started an Amphetamine session")
}

async function release(reason) {
  S.holding = false
  stopWatcher()
  rmSync(WORKING_FILE, { force: true })
  if (claudeCodeIsWorking()) return log(`agents stopped (${reason}); Claude Code is still working, so Amphetamine stays on`)
  if (!existsSync(OWNED_FILE)) return log(`agents stopped (${reason}); your own Amphetamine session was left running`)
  await amphetamine("end session")
  rmSync(OWNED_FILE, { force: true })
  log(`ended the Amphetamine session (${reason})`)

  await delay(SETTLE_MS)
  if ((await amphetamine("session is active")).out === "true") return
  if (await sleepDisabled()) {
    const result = await setSleepDisabled("0")
    log(result.ok ? "SleepDisabled was left at 1; set it to 0" : `could not clear SleepDisabled: ${result.error}`)
  }
  if ((await workingSessions())?.working.length || claudeCodeIsWorking()) return
  const slept = await run("/bin/sh", ["-c", SLEEP_IF_LID_CLOSED], 30_000)
  if (!slept.ok) log(`could not put the Mac to sleep: ${slept.error}`)
}

async function tick() {
  if (S.ticking) return
  S.ticking = true
  try {
    const sessions = await workingSessions()
    if (sessions === undefined) return

    let reason = ""
    if (!sessions.active.length) reason = "no agents running"
    else if (!sessions.working.length) reason = "agents are waiting for your reply"
    else {
      const power = await battery()
      if (power.discharging && power.percent <= MIN_BATTERY_PERCENT) reason = `battery at ${power.percent}%`
    }

    if (!reason) return await hold()
    if (sessions.active.length) logOnce(`not keeping the Mac awake: ${reason}`)
    if (!S.holding) return
    if (reason.startsWith("battery") || Date.now() - S.lastWanted >= GRACE_MS) await release(reason)
  } catch (error) {
    log(`tick failed: ${error?.message ?? error}`)
  } finally {
    S.ticking = false
  }
}

function listen(ctx, signal) {
  void (async () => {
    try {
      // Start at once, so closing the lid right after sending a prompt is safe.
      for await (const _ of ctx.event.subscribe({ signal, types: ["session.execution.started"] })) void tick()
    } catch (error) {
      if (!signal.aborted) log(`event stream stopped: ${error?.message ?? error}`)
    }
  })()
}

export default {
  id: "amphetamine-keepawake",
  setup(ctx) {
    if (process.platform !== "darwin") return
    if (!existsSync("/Applications/Amphetamine.app")) return log("Amphetamine is not installed, so doing nothing")

    clearTimeout(S.unloadTimer)
    S.instances.add(ctx)
    const controller = new AbortController()
    try {
      mkdirSync(SHARED_DIR, { recursive: true })
      if (statSync(LOG_FILE, { throwIfNoEntry: false })?.size > 512_000) writeFileSync(LOG_FILE, "")
      if (S.instances.size === 1) {
        adoptPriorHold()
        log(`loaded in OpenCode ${ctx.app?.version ?? "unknown"} (server ${process.pid})`)
      }
      // Replaced on every load: a reload adds the new instance before removing the old one, and an old timer would
      // keep running the old code.
      clearInterval(S.timer)
      S.timer = setInterval(() => void tick(), TICK_MS)
      listen(ctx, controller.signal)
      void tick()
    } catch (error) {
      log(`setup failed: ${error?.message ?? error}`)
    }

    return () => {
      controller.abort()
      S.instances.delete(ctx)
      if (S.instances.size) return
      clearInterval(S.timer)
      S.timer = undefined
      // A reload loads the plugin again straight away. If nothing does, the plugin was removed, so let go.
      S.unloadTimer = setTimeout(() => {
        if (S.holding) void release("plugin removed")
      }, 30_000)
      S.unloadTimer.unref?.()
    }
  },
}
