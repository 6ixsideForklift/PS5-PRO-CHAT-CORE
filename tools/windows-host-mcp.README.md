# Private Windows laptop tools for LibreChat

This helper runs on the Windows host as the signed-in Windows user. It listens only on
`127.0.0.1:8766` and requires both a private API token and the configured LibreChat
admin user ID for tool calls. The standard USER role must have **MCP servers → Use**
disabled. Keep the agent private; do not share it with other users.

## Start after signing in to Windows

From PowerShell:

```powershell
Set-Location E:\PS5-PRO-CHAT-CORE
.\tools\start-windows-host-mcp.ps1
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
