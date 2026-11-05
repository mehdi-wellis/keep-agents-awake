# Keep your AI agents working when you close your laptop

You give an AI agent a big task, close your MacBook, and walk away. When you come back, nothing has happened. Your Mac went to sleep, and the agent stopped with it.

This guide fixes that. Your agent keeps working with the lid closed or the screen locked.

It's free and takes about 10 minutes.

## Why it's worth it

- **Walk away from long tasks.** Go to lunch or a meeting while the work carries on.
- **Stop babysitting.** No more leaving the lid open or nudging the mouse.
- **Stay secure.** Your screen still locks as normal.

## Before you start

- **You need a Mac.** On Windows, see [Using Windows?](#using-windows)
- **You need to be an admin on your Mac.** If an install asks for an admin password you don't have, ask IT.
- **Your agent must run on your Mac.** Agents that run in the cloud, like Codex Cloud or Claude Code on the web, keep going without this.

## Setup

### Step 1: Install Amphetamine

Amphetamine is a free, trusted app that stops your Mac from going to sleep.

1. Open [Amphetamine on the Mac App Store](https://apps.apple.com/us/app/amphetamine/id937984704?mt=12).
2. Click **Get**, then **Open**.
3. Look for a small pill icon at the top of your screen, in the menu bar.

### Step 2: Install Power Protect

Power Protect is a small add-on from the same developer. Without it, plugging in or unplugging your charger can make your Mac fall asleep mid-task.

1. Open the [Power Protect page](https://x74353.github.io/Amphetamine-Power-Protect/).
2. Download the installer and double-click it.
3. Confirm with Touch ID or your password.

It adds one small rule to your Mac, which lets Amphetamine switch sleep off and on without asking for your password. On a company laptop, check with IT if you're not sure this is allowed.

### Step 3: Change Amphetamine's settings

Click the pill icon, then open **Settings** or **Quick Settings**. Set these:

| Setting | Set it to |
|---|---|
| Allow system sleep when display is closed | **Off** (the important one) |
| Allow display sleep | On |
| Allow display sleep when screen is locked | On |
| Lock screen immediately after display is closed | On |
| End session if battery % is... | On, 20% |
| Launch Amphetamine at login | On |

### Step 4: Connect it to your agent

| You use | What to do | How it works |
|---|---|---|
| **OpenCode** | [Paste this prompt](#for-opencode) | Fully automatic and tested |
| **Claude Code** in the terminal or the Claude app's Code tab | [Paste this prompt](#for-claude-code) | Fully automatic and tested |
| **Claude app, Chat or Cowork** | See [Using Chat or Cowork?](#using-chat-or-cowork-in-the-claude-app) | Automatic setup can't see these |
| **Codex** | [Paste this prompt](#for-codex-and-other-agents) | Your agent sets it up. Not tested by us yet |
| **Anything else** | [Start it by hand](#the-simple-way-works-with-any-agent) | Two clicks each time |

## Copy and paste prompts

### For OpenCode

Paste this into OpenCode:

```text
Please install the keep-agents-awake plugin for OpenCode on this Mac.

1. Check that Amphetamine is in /Applications and that the file /etc/sudoers.d/amphetamine_PowerProtect exists. If either is missing, stop and send me to the setup guide: https://github.com/mehdi-wellis/keep-agents-awake
2. Download https://raw.githubusercontent.com/mehdi-wellis/keep-agents-awake/main/opencode/amphetamine-keepawake.js and save it as ~/.config/opencode/plugins/amphetamine-keepawake.js. Create the folder if needed.
3. Wait 30 seconds, then read ~/Library/Logs/opencode-amphetamine.log. It should say the plugin loaded and that an Amphetamine session started.
4. Run: pmset -g | grep SleepDisabled
   It should show SleepDisabled 1.

Don't use sudo and don't change anything else. Tell me in plain words if it worked.
```

If your Mac asks whether OpenCode can control Amphetamine, click **Allow**.

### For Claude Code

Paste this into Claude Code:

```text
Please install keep-agents-awake for Claude Code on this Mac.

1. Check that Amphetamine is in /Applications and that the file /etc/sudoers.d/amphetamine_PowerProtect exists. If either is missing, stop and send me to the setup guide: https://github.com/mehdi-wellis/keep-agents-awake
2. Download https://raw.githubusercontent.com/mehdi-wellis/keep-agents-awake/main/claude-code/keepawake.sh to a temporary folder. Read it and tell me in one sentence what it does.
3. Run it with: sh <that file> install
4. Tell me to click Allow if my Mac asks to let it control Amphetamine. The popup can hide behind other windows, and nothing works until I answer it.
5. Run: sleep 25
6. Then run: pmset -g | grep SleepDisabled
   It should show SleepDisabled 1.
7. Read ~/Library/Logs/claude-amphetamine.log. It should say an Amphetamine session started.

Don't use sudo and don't change anything else. Tell me in plain words if it worked.
```

This adds a small background check to your Mac, which looks at Claude Code every 10 seconds. It doesn't change your Claude settings. macOS may show a "background item added" notice, which is expected.

### For Codex and other agents

Paste this into your agent:

```text
Please set up this Mac so Amphetamine stays on while you're working, so you keep running with my laptop lid closed.

Amphetamine can be controlled like this:
  osascript -e 'tell application "Amphetamine" to session is active'
  osascript -e 'tell application "Amphetamine" to start new session with options {duration:12, interval:hours, displaySleepAllowed:true}'
  osascript -e 'tell application "Amphetamine" to end session'

Use your own hooks feature, and read your official docs on hooks first. If you don't have hooks, tell me and stop. Put this in my personal settings, not in a project.

Follow these rules:
1. When I send a prompt, start an Amphetamine session, but only if none is active. Never start one on top of another, because that can break lid-closed mode.
2. When work stops, or you're waiting for my answer or approval, wait 30 seconds. If none of your other chats are working, end the session. Start it again once I reply.
3. Only end sessions you started. Never end one I started myself.
4. Handle several chats at once. Only end the session when none are working.
5. If the lid is still closed when you end the session, and no external display is connected, put the Mac to sleep with: pmset sleepnow
6. Don't start a session on battery at 20% or lower.
7. Count a command you started in the background as work, for up to 2 hours.
8. Write what you do to a log in ~/Library/Logs/.

Don't use sudo. If you need me to approve anything, tell me exactly what to click. When you're done, test that a prompt starts a session and that it ends afterwards. Then tell me in plain words what you did, what you couldn't test, and how to undo it.
```

Codex asks you to approve new hooks first. Type `/hooks` and approve them.

### The simple way (works with any agent)

Do this before you walk away:

1. Click the pill icon.
2. Choose **Start New Session** and pick how long you need.
3. Close the lid.

End the session when you're back, or let the timer run out.

### Using Chat or Cowork in the Claude app?

The automatic setup watches Claude Code, so don't count on Amphetamine switching on for these. It doesn't for Chat, and we haven't tested Cowork.

- **Normal chats:** you don't need this guide. A chat keeps going without your Mac, even if you close the app.
- **Tasks using your Mac:** if Claude is working in your folders, your apps or the app's built-in browser, your Mac has to stay awake. [Start Amphetamine by hand](#the-simple-way-works-with-any-agent) first.

## Test that it works

1. Start a session, or give your agent a task if you set up the automatic version.
2. Open **Terminal** (press Cmd+Space and type Terminal).
3. Paste this and press Return:

   ```sh
   pmset -g | grep SleepDisabled
   ```

4. It should show `SleepDisabled 1`.
5. Give your agent a small task, close the lid for a few minutes, and check that it made progress.

## Good to know

- **Wait 15 seconds before closing the lid.** Give it a moment to switch on after you send a prompt.
- **Never put your Mac in a bag while an agent is working.** It stays fully awake and can get hot. Leave it on a desk.
- **Lock your screen, don't log out.** Locking is fine, but logging out stops your agents.
- **Plug in for long tasks.** Amphetamine stops at 20% battery if you set it up in Step 3.
- **Questions pause everything.** With the automatic setup, if your agent asks a question or needs permission while the lid is closed, your Mac goes to sleep once any background commands finish. Open it, answer, and the agent carries on.
- **Forgotten servers can keep your Mac awake.** A dev server left running in the background counts as work for up to 2 hours.
- **Built-in keep-awake settings aren't enough.** Claude's **Keep computer awake** and Codex's **Prevent sleep while running** only stop idle sleep. Closing the lid can still put your Mac to sleep.
- **Your agent needs internet.** Stay on Wi-Fi you trust.

## How it works

A Mac normally goes to sleep the moment you close the lid. Amphetamine tells it to stay awake instead, and Power Protect keeps that working when your charger is plugged in or removed.

The OpenCode plugin and the Claude Code background check do the switching for you:

| Situation | What happens |
|---|---|
| An agent is working | Amphetamine turns on within 15 seconds |
| An agent asks you a question or needs permission | Amphetamine turns off within about 45 seconds, unless a background command is still running |
| You answer | Amphetamine turns back on within 15 seconds |
| All work is finished, you press Esc, or Claude Code crashes | Amphetamine turns off within about 45 seconds, and your Mac sleeps if the lid is closed |
| OpenCode and Claude Code are both working | Amphetamine stays on until both have stopped |
| A background command is running, like a long build or test | Counts as work for its first 2 hours, so it finishes with the lid closed |
| Unplugged at 20% battery or less | Amphetamine turns off straight away |
| You started a session yourself | It's left alone |

While an agent is running, a session you end by hand comes back within 15 seconds.

## Something not working?

| Problem | Try this |
|---|---|
| Mac sleeps when you close the lid | Check that **Allow system sleep when display is closed** is off |
| The test shows `SleepDisabled 0` or nothing | Quit Amphetamine, open it again, and start a new session |
| Mac sleeps after you plug in or unplug | Install Power Protect (Step 2) |
| Starting a new session breaks it | End the current session first, then start a new one |
| OpenCode isn't switching Amphetamine on | Ask OpenCode to read `~/Library/Logs/opencode-amphetamine.log` |
| Claude Code isn't switching Amphetamine on | Look for a hidden permission popup, then ask Claude Code to read `~/Library/Logs/claude-amphetamine.log` |

Amphetamine has a known bug where sleep protection can quietly switch off. The automatic setups fix this by themselves. If you start sessions by hand, run the test above before you leave for anything important.

## Using Windows?

Amphetamine is Mac only. Microsoft's free PowerToys app has a similar tool called Awake. You also need to set your laptop's "when I close the lid" option to **Do nothing**. We haven't tested this.

## How to remove it

1. **OpenCode plugin:** delete `~/.config/opencode/plugins/amphetamine-keepawake.js`.
2. **Claude Code background check:** open Terminal, paste this and press Return:

   ```sh
   sh ~/.local/share/keep-agents-awake/keepawake.sh uninstall
   ```

3. **Power Protect:** click the pill icon, then **Feedback & Support**, then **Uninstall Scripts...**
4. **Amphetamine:** delete it from your Applications folder.

For Codex, ask your agent to undo the setup.

## What's been tested

Tested on a MacBook Pro (M5 Pro) with macOS 27.2, Amphetamine 5.3.2, OpenCode 2.2.5 and Claude Code 2.1.317:

- Starting and stopping automatically
- Turning off while an agent waits for your answer, and back on when you reply
- Claude Code permission prompts, pressing Esc, and a crash, in the terminal
- A 2-minute background command in the Claude app's Code tab, with the lid closed. The Mac stayed awake until it finished, then went to sleep by itself
- Keeping Amphetamine on for a background command while OpenCode waits for your answer
- Using OpenCode and Claude Code at the same time
- Handing over from a session you started yourself
- Fixing sleep protection when it switches off
- Closing the lid and locking the screen for short periods, on battery

Not tested yet:

- Runs longer than a few minutes with the lid closed
- Plugging in or unplugging mid-task
- The automatic 20% battery cutoff
- A subagent asking a question or needing permission
- Claude Code in an editor like VS Code
- Cowork in the Claude app, so start Amphetamine by hand to be safe
- The prompt for Codex and other agents
