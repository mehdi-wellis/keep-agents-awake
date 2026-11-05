#!/bin/sh
# Keeps an Amphetamine session running while Claude Code is working, so it carries on with the lid closed.
# Setup guide: see the README in the keep-agents-awake repo.
#
#   sh keepawake.sh install     set it up for this Mac user
#   sh keepawake.sh uninstall   remove it
#   sh keepawake.sh run         one check. macOS runs this every 10 seconds
#
# Log: ~/Library/Logs/claude-amphetamine.log

GRACE_SECONDS=30 # Stay awake this long after Claude Code stops, so a brief gap doesn't end the session.
MIN_BATTERY_PERCENT=20
SESSION_HOURS=24 # Amphetamine ends the session itself by then, even if everything here has died.
OTHER_AGENT_FRESH_SECONDS=60

LABEL=com.keep-agents-awake.claude
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
INSTALL_DIR=$HOME/.local/share/keep-agents-awake
LOG_FILE=$HOME/Library/Logs/claude-amphetamine.log

# Shared with the OpenCode plugin, so neither switches Amphetamine off while the other is still working.
STATE_DIR=$HOME/.local/state/keep-agents-awake
OWNED_FILE=$STATE_DIR/owned # Exists while the running Amphetamine session is one we started.
WORKING_FILE=$STATE_DIR/claude-working # Touched on every check while Claude Code is working.
OPENCODE_WORKING_FILE=$STATE_DIR/opencode-working
FIRST_RUN_FILE=$STATE_DIR/claude-first-run

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >>"$LOG_FILE"
}

amphetamine() {
  /usr/bin/osascript -e "tell application \"Amphetamine\" to $1" 2>/dev/null
}

sleep_disabled() {
  /usr/bin/pmset -g | /usr/bin/grep -q 'SleepDisabled[[:space:]]*1'
}

set_sleep_disabled() {
  /usr/bin/sudo -n /usr/bin/pmset -a disablesleep "$1" 2>/dev/null
}

is_fresh() {
  [ -f "$1" ] && [ $(($(date +%s) - $(/usr/bin/stat -f %m "$1"))) -lt "$2" ]
}

# Prints the process ID of each Claude Code session that's generating or running a tool. `claude agents --json` reports
# "busy" for those, "waiting" on a question or permission prompt, and "idle" when finished or after Esc.
# OpenCode runs Claude Code internally and has its own plugin, so its sessions are skipped.
busy_sessions() {
  pids=$("${CLAUDE_BIN:-claude}" agents --json 2>/dev/null | /usr/bin/perl -MJSON::PP -e '
    local $/;
    my $sessions = decode_json(<STDIN>);
    print "$_->{pid}\n" for grep { ($_->{status} // "") eq "busy" } @$sessions;
  ') || return 1
  for pid in $pids; do
    parent=$(/bin/ps -o ppid= -p "$pid" | /usr/bin/tr -d ' ')
    case "$(/bin/ps -o comm= -p "${parent:-0}")" in
      *opencode*) ;;
      *) echo "$pid" ;;
    esac
  done
}

battery_is_low() {
  batt=$(/usr/bin/pmset -g batt)
  case "$batt" in
    *"Battery Power"*) ;;
    *) return 1 ;;
  esac
  percent=$(echo "$batt" | /usr/bin/grep -o '[0-9]*%' | /usr/bin/head -1 | /usr/bin/tr -d '%')
  [ "${percent:-100}" -le "$MIN_BATTERY_PERCENT" ]
}

# macOS only sleeps at the moment the lid closes, so a Mac whose work ends later stays awake unless told to sleep.
# Skipped when an external display is in use, because then the closed lid is deliberate.
sleep_if_lid_closed() {
  case "$(/usr/sbin/ioreg -r -k AppleClamshellState -d 1)" in
    *'"AppleClamshellState" = Yes'*) ;;
    *) return ;;
  esac
  displays=$(/usr/sbin/system_profiler SPDisplaysDataType)
  [ -n "$displays" ] || return
  shown=$(printf '%s\n' "$displays" | /usr/bin/grep -c 'Resolution:')
  internal=$(printf '%s\n' "$displays" | /usr/bin/grep -c 'Connection Type: Internal')
  [ "$shown" -gt "$internal" ] && return
  log "lid is closed and work has ended, putting the Mac to sleep"
  /usr/bin/pmset sleepnow >/dev/null
}

keep_awake() {
  [ -f "$WORKING_FILE" ] || log "Claude Code is working"
  touch "$WORKING_FILE"

  session=$(amphetamine "session is active")
  case "$session" in
    true)
      # Respect "Allow system sleep when display is closed" if it's been turned back on.
      if ! sleep_disabled && [ "$(amphetamine 'closed display mode enabled')" = true ]; then
        if set_sleep_disabled 1; then
          log "SleepDisabled had dropped to 0; set it back to 1"
        else
          log "could not restore SleepDisabled. Is Power Protect installed?"
        fi
      fi
      ;;
    false)
      # Only reached with no session running. Starting one over a running session breaks Closed-Display Mode.
      if amphetamine "start new session with options {duration:$SESSION_HOURS, interval:hours, displaySleepAllowed:true}" >/dev/null; then
        touch "$OWNED_FILE"
        log "started an Amphetamine session"
      else
        log "could not start an Amphetamine session"
      fi
      ;;
    *) log "could not reach Amphetamine. Did macOS ask for permission?" ;;
  esac
}

let_go() {
  [ -f "$WORKING_FILE" ] || return
  is_fresh "$WORKING_FILE" "$1" && return
  rm -f "$WORKING_FILE"

  if is_fresh "$OPENCODE_WORKING_FILE" "$OTHER_AGENT_FRESH_SECONDS"; then
    log "Claude Code stopped ($2); OpenCode is still working, so Amphetamine stays on"
    return
  fi
  if [ ! -f "$OWNED_FILE" ]; then
    log "Claude Code stopped ($2); your own Amphetamine session was left running"
    return
  fi

  amphetamine "end session" >/dev/null
  rm -f "$OWNED_FILE"
  log "ended the Amphetamine session ($2)"

  # Amphetamine changes SleepDisabled a few seconds after a session ends.
  sleep 10
  [ "$(amphetamine 'session is active')" = true ] && return
  if sleep_disabled; then
    set_sleep_disabled 0 && log "SleepDisabled was left at 1; set it to 0"
  fi
  [ -n "$(busy_sessions)" ] && return
  is_fresh "$OPENCODE_WORKING_FILE" "$OTHER_AGENT_FRESH_SECONDS" && return
  sleep_if_lid_closed
}

run_once() {
  [ -d /Applications/Amphetamine.app ] || exit 0
  mkdir -p "$STATE_DIR"

  # Asks once during install, while you're watching, so macOS doesn't ask mid-task with nobody there to click Allow.
  if [ -f "$FIRST_RUN_FILE" ]; then
    rm -f "$FIRST_RUN_FILE"
    amphetamine "session is active" >/dev/null
  fi

  # If Claude Code can't be asked, change nothing this round.
  busy=$(busy_sessions) || exit 0

  if [ -z "$busy" ]; then
    let_go "$GRACE_SECONDS" "not working"
  elif battery_is_low; then
    let_go 0 "low battery"
  else
    keep_awake
  fi
}

install() {
  claude=$(command -v claude || echo "$HOME/.local/bin/claude")
  [ -x "$claude" ] || { echo "Couldn't find Claude Code. Install it first, then run this again."; exit 1; }
  [ -d /Applications/Amphetamine.app ] || { echo "Couldn't find Amphetamine. Install it first (see the README)."; exit 1; }
  "$claude" agents --json >/dev/null 2>&1 || { echo "This needs a newer Claude Code. Update it, then run this again."; exit 1; }

  mkdir -p "$INSTALL_DIR" "$STATE_DIR" "$(dirname "$PLIST")"
  [ "$0" = "$INSTALL_DIR/keepawake.sh" ] || cp "$0" "$INSTALL_DIR/keepawake.sh"

  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$INSTALL_DIR/keepawake.sh</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDE_BIN</key><string>$claude</string>
    <key>PATH</key><string>$(dirname "$claude"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>10</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST

  touch "$FIRST_RUN_FILE"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || { echo "macOS couldn't start the background check."; exit 1; }
  log "installed"

  echo "Done. If your Mac asks to let this control Amphetamine, click Allow. The popup can hide behind other windows."
  [ -f /etc/sudoers.d/amphetamine_PowerProtect ] || echo "Power Protect isn't installed yet. See Step 2 in the README."
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  if [ -f "$OWNED_FILE" ] && [ -f "$WORKING_FILE" ]; then
    amphetamine "end session" >/dev/null
    rm -f "$OWNED_FILE"
  fi
  rm -f "$PLIST" "$WORKING_FILE" "$FIRST_RUN_FILE" "$INSTALL_DIR/keepawake.sh"
  rmdir "$INSTALL_DIR" 2>/dev/null
  echo "Removed. Amphetamine itself is still installed."
}

case "$1" in
  run)
    run_once
    exit 0
    ;;
  install) install ;;
  uninstall) uninstall ;;
  *) echo "Use: sh keepawake.sh install, or sh keepawake.sh uninstall"; exit 1 ;;
esac
