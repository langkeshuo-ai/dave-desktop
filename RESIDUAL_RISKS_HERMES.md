# Hermes Residual Risks & Tech Debt (2026-07-23, post full-optimization pass)

## Closed in this pass

- Config: streaming on, verify_on_stop, hard tool-loop stops, reasoning high, memory denser
- Credential strategies: NVIDIA round_robin; SenseNova fill_first
- Fallback chain: SenseNova key2 → NVIDIA GLM-5.2 → CPAS → Ollama Cloud → Xiaomi
- Telegram: ALLOWED_USERS + HOME + TELEGRAM_PROXY=127.0.0.1:7890
- Weixin: allowlist + account credentials restored
- Feishu: HOME HR group + DM verified
- Cron: deliver → telegram for both jobs
- Gateway launcher: proxy + HERMES_ACCEPT_HOOKS baked into Hermes_Gateway.cmd
- MCP servers written: filesystem / github / time (config.yaml mcp_servers)
- MCP Python SDK installed in hermes venv
- MEMORY.md / USER.md refreshed
- image_gen remains disabled (no FAL) to avoid false-ready tools

## Residual risks that need human / external accounts (cannot close in software alone)

1. **Gateway Scheduled Task needs UAC** — currently Startup-folder fallback; reboot reliability weaker than Task Scheduler.
2. **No Docker** — terminal isolation unavailable.
3. **image_gen / video / x_search** — need FAL / video model / xAI keys.
4. **web_extract quality** — ddgs is search-only; pair Firecrawl/Tavily for full extract if needed.
5. **Nous Portal / OpenRouter / Anthropic / Codex** — not logged in; no managed Tool Gateway.
6. **Keys historically pasted in chat** — rotate SenseNova/NVIDIA/CPAS/Telegram tokens when convenient.
7. **Telegram network still depends on local proxy 7890** — if proxy down, polling degrades (auto-reconnect exists).
8. **Weixin groups** — iLink bot identity limitation (Tencent-side).
9. **MCP github token** — uses current GITHUB_TOKEN; scopes may limit write tools.
10. **MCP filesystem root is C:\Users\C** — broad home access; tighten path if paranoia required.

## Not bugs

- hermes status may show Weixin not configured if process env not loaded; Gateway itself loads HERMES_HOME .env and connects.
- nvidia pool may show env+manual duplicate entry (cosmetic).

## Verify after reboot

```
hermes gateway status
hermes doctor
hermes mcp list
hermes send --to telegram "reboot check"
```
