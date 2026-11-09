# Private Windows laptop tools for LibreChat

This helper runs on the Windows host as the signed-in Windows user. It listens only on
`127.0.0.1:8766` and requires both a private API token and the configured LibreChat
admin user ID for tool calls. The standard USER role must have **MCP servers → Use**
disabled. Keep the agent private; do not share it with other users.

## Start after signing in to Windows

The `PS5 PRO CHAT Startup` shortcut in the current user's Windows Startup folder
runs `start-ps5-pro-chat.ps1` at sign-in. It starts this helper, launches Docker
Desktop if needed, and brings up the existing Compose project. Startup activity
is recorded in the ignored `.ps5-startup.log` file. The desktop `PS5 PRO CHAT`
shortcut opens `http://localhost:3081/`.

To start it manually:

From PowerShell:

```powershell
Set-Location E:\PS5-PRO-CHAT-CORE
.\tools\start-ps5-pro-chat.ps1
```

The script needs the ignored `.ps5-windows-mcp.json` file created during local
setup. The token also lives in the ignored `.env.ps5-dev` as
`PS5_WINDOWS_MCP_TOKEN`. Never commit either file.

The local, ignored `librechat.yaml` needs this configuration:

```yaml
mcpSettings:
  allowedAddresses:
    - host.docker.internal:8766
mcpServers:
  windows-host:
    title: Private Windows Laptop
    description: Admin-only access to Windows files and PowerShell
    type: streamable-http
    url: http://host.docker.internal:8766/mcp
    headers:
      X-API-Key: '${PS5_WINDOWS_MCP_TOKEN}'
    requestHeaders:
      X-LibreChat-User-Id: '{{LIBRECHAT_USER_ID}}'
    requiresOAuth: false
    chatMenu: false
```

Restart the LibreChat API container after changing `librechat.yaml` or its env
file. Attach `windows-host` only to the private admin agent. The helper offers
directory listing, UTF-8 file reads and writes, and PowerShell commands. There
are no path restrictions; commands execute without an approval prompt.

## Screen control

The helper also offers `screen_monitors`, `screen_capture`, `screen_click`,
`screen_type`, `screen_key`, `screen_scroll`, and `screen_control_end`. These
require Python 3, Pillow, pytesseract, pywin32, Tesseract OCR, and Windows
Tkinter on the host. `screen_capture` returns compact OCR text and coordinates
for visible windows and controls. The local text model cannot accept a full
MCP screenshot without exceeding its context window. A yellow **PS5 PRO
OPERATOR · SCREEN CONTROL ACTIVE** banner appears on every monitor while the
agent uses these tools. It scales with each monitor's resolution and is
translucent so the desktop remains visible behind it. Click its **STOP** button
or press **Ctrl+Alt+Esc** from any monitor to stop screen control. Further
screen actions are refused until you click the **Resume PS5 Screen Control**
desktop shortcut. The indicator also disappears 150 seconds after the last
screen action or when `screen_control_end` runs. Windows excludes the banners from screen captures
where display affinity is supported.

`screen_monitors` lists monitor indexes and screen coordinates. The default
capture reads the primary monitor; `monitor` selects another, `scope: all`
covers all monitors, and `region` reads a smaller rectangle with absolute
coordinates. Screen clicks and keys require a capture from the last 120 seconds.
Pass a window's exact title as `activate_window_title` to `screen_capture` when
it is behind another app or only appears on the taskbar. `screen_click` requires
the exact `window_title`; it restores and foregrounds that window and refuses
to click if another window covers the target point. Typing, keys, and scrolling
are refused if the target loses focus. `screen_type` pastes the requested text
and restores supported clipboard formats; it refuses to paste when the current
clipboard cannot be safely preserved. Verify saved files separately before
reporting success.

`screen_monitors` also lists visible window titles and the monitor each belongs
to. When `activate_window_title` is provided, the capture waits briefly for a
newly launched window and moves it to the monitor the agent selected. If no
monitor was selected, it uses the primary monitor. Set
`move_to_capture_monitor: false` to leave the window on its current monitor.
The returned coordinates reflect its new location; use those for later clicks.

Screen actions run as the signed-in Windows user and cannot control elevated
windows or the Windows secure desktop. Only the private admin agent should use
this server; the standard USER role must retain MCP Use disabled.
