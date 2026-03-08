# Multi-Agent Consolidation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate all AI infrastructure (OpenClaw VPS, OpenClaw Mini, PAI crons) into ClaudeClaw multi-agent on the Mac Mini, then decommission the VPS and OpenClaw instances.

**Architecture:** ClaudeClaw runs on Mac Mini as the always-on hub. Each domain (real estate, PM, content) runs as a separate agent process with its own Telegram bot, cwd pointing to the relevant repo, and domain-specific CLAUDE.md. The main bot (`@Claude_don_bot`) remains central command. PAI cron jobs move into ClaudeClaw scheduled tasks where possible.

**Tech Stack:** ClaudeClaw (Node.js/TypeScript), Claude Agent SDK, grammy (Telegram), SQLite, Python (Reef pipeline scripts), Playwright (browser automation)

---

## Current State Inventory

### What's Running Now

| System | Location | Status | Action |
|--------|----------|--------|--------|
| ClaudeClaw main | Mac Mini | Running, healthy | Keep |
| OpenClaw gateway | Mac Mini (`ai.openclaw.gateway`) | Running | Retire after migration |
| OpenClaw watchdog | Mac Mini (`com.openclaw.watchdog`) | Running | Retire |
| AtlasHQ dashboard | Mac Mini (`com.proman.atlashq`) | Running (port 3001) | Retire (ClaudeClaw dashboard replaces) |
| Lima OpenClaw | Mac Mini (`com.lima.dons-openclaw`) | Running | Retire |
| OpenClaw (Reef) | VPS `89.167.88.246` | Running | Migrate skills, then decommission VPS |
| PAI crons | MacBook crontab | Running | Review, migrate to ClaudeClaw tasks or keep |
| PAI crons | Mini crontab | Running | Review, migrate or keep |
| Content OS crons | Mini crontab | Running | Review, migrate or keep |

### OpenClaw Mini Workspaces → Where They Go

| Workspace | Skills | Migration Target |
|-----------|--------|-----------------|
| workspace-atlas | ai-construction-brief, assess-pm, daily-brief, project-status, risk-management, jbcc-variation | Already in business-os commands. Drop. |
| workspace-cadence | system-health, memory-health, dream-cycle, security-monitor, etc. | ClaudeClaw handles natively. Drop. |
| workspace-gumbo | daily-intake, field-progress-capture/report/review, task-management | business-os skills. Drop. |
| workspace-radar | check-views, ingest-*, process-email, process-inbox, rebuild-views, sync-project | Already in business-os commands. Drop. |
| workspace-scribe | content-radar, produce-content | Already in content-os. Drop. |

### VPS Reef Skills → Migration

| Skill | Type | Target |
|-------|------|--------|
| remax-hub | Python script + SKILL.md | Copy to `agents/reef/skills/remax-hub/` |
| hubspot | SKILL.md (curl-based) | Copy to `agents/reef/skills/hubspot/` |
| google-sheets | Python script + SKILL.md | Copy to `agents/reef/skills/google-sheets/` |
| pipeline | Python script + SKILL.md | Copy to `agents/reef/skills/pipeline/` |
| gmail-otp | Unknown | Evaluate, likely drop (Claude has Gmail MCP) |
| agent-browser | Policy doc | Replace with Playwright MCP (already in ClaudeClaw plugins) |

---

## Task 1: Extend ClaudeClaw Agent Config to Support External cwd

Currently `agentCwd` defaults to `agents/{id}/` inside ClaudeClaw. Agents like business-os and content-os need cwd pointing to external repos.

**Files:**
- Modify: `src/agent-config.ts`
- Modify: `agents/_template/agent.yaml.example`

**Step 1: Add `cwd` field to AgentConfig interface and loader**

In `src/agent-config.ts`, add `cwd?: string` to the `AgentConfig` interface. In `loadAgentConfig()`, read `raw['cwd']` and resolve it to an absolute path. If not set, default to the agent directory.

```typescript
// In AgentConfig interface, add:
cwd?: string;

// In loadAgentConfig(), after reading other fields:
const rawCwd = raw['cwd'] as string | undefined;
const cwd = rawCwd ? path.resolve(rawCwd.replace(/^~/, process.env.HOME || '')) : agentDir;

// Return cwd in the config object
```

**Step 2: Update index.ts to use config.cwd**

In `src/index.ts` line 30, change `cwd: agentDir` to `cwd: agentConfig.cwd || agentDir`.

**Step 3: Update template**

Add `# cwd: ~/path/to/repo  # External working directory (optional)` to `agent.yaml.example`.

**Step 4: Build and verify**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/agent-config.ts src/index.ts agents/_template/agent.yaml.example
git commit -m "feat: support external cwd in agent config"
```

---

## Task 2: Create Reef Agent

**Files:**
- Create: `agents/reef/agent.yaml`
- Create: `agents/reef/CLAUDE.md`
- Create: `agents/reef/skills/` (copied from VPS)

**Step 1: Create bot for Reef via @BotFather**

Don creates a new Telegram bot (e.g. `@ReefAssistantBot`). Get the token.

**Step 2: Create agent.yaml**

```yaml
name: Reef
description: Lead enrichment agent for RE/MAX real estate pipeline. Manages Google Sheets leads, REMAX Hub lookups, HubSpot CRM enrichment.

telegram_bot_token_env: REEF_BOT_TOKEN

model: claude-opus-4-6

cwd: ~/reef-agent
```

**Step 3: Add REEF_BOT_TOKEN to .env**

Don adds the token to `~/claudeclaw/.env` manually (security hook blocks writes).

**Step 4: Write Reef's CLAUDE.md**

```markdown
# Reef

You are Reef, Don's lead enrichment agent for a RE/MAX real estate partnership.

## Your Role
Process homeowner leads from Google Sheets, enrich them via REMAX Hub lookups, create/update contacts in HubSpot CRM, and report results.

## Who You Work For
- **Don** (Donovan) — CEO of PROMAN. Built you. Communicates via Telegram.
- **Juanita** — RE/MAX estate agent. End-user of the pipeline. Don's business partner on this.

## Pipeline
Google Sheets (leads) → REMAX Hub (SA ID lookup) → HubSpot (create/enrich contacts) → Report

## Skills
Your skills are in ~/reef-agent/workspace-reef/skills/:
- `remax-hub/` — Browser automation for REMAX Hub lookups
- `hubspot/` — HubSpot CRM API (contacts, companies, deals)
- `google-sheets/` — Read/write lead spreadsheets
- `pipeline/` — End-to-end orchestrator

## Credentials (env vars)
- REMAX_HUB_EMAIL, REMAX_HUB_PASSWORD
- HUBSPOT_ACCESS_TOKEN
- GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID

## Rules
- POPIA compliance: SA ID numbers for lookup only, never persist
- Rate limit REMAX Hub: 3-5 seconds between lookups, max 50/run
- If deceased, skip and mark "Skipped - Deceased"
- Report results via Telegram after each pipeline run
- Log actions to hive mind so other agents can see
```

**Step 5: Copy skills from VPS**

```bash
# From MacBook:
scp -r reef:~/reef-agent/workspace-reef/skills/remax-hub agents/reef/skills/
scp -r reef:~/reef-agent/workspace-reef/skills/hubspot agents/reef/skills/
scp -r reef:~/reef-agent/workspace-reef/skills/google-sheets agents/reef/skills/
scp -r reef:~/reef-agent/workspace-reef/skills/pipeline agents/reef/skills/
```

Note: The SKILL.md files are already Claude-compatible (they're markdown with YAML frontmatter). The Python scripts stay as-is -- Claude calls them via Bash. Update paths in SKILL.md files from `/home/openclaw/...` to `~/reef-agent/workspace-reef/skills/...`.

**Step 6: Update pipeline paths**

In each SKILL.md, replace VPS-specific paths:
- `/home/openclaw/.openclaw/browser/remax-hub` → `~/.config/remax-hub-profile` (or Mini equivalent)
- `agent-browser` references → Playwright MCP (`mcp__plugin_playwright_playwright__*`)
- `openclaw config set env.vars.KEY` → env vars in ClaudeClaw `.env`

**Step 7: Commit**

```bash
git add agents/reef/
git commit -m "feat: add Reef agent (RE/MAX lead enrichment)"
```

---

## Task 3: Create Business-OS Agent

**Files:**
- Create: `agents/business/agent.yaml`
- Create: `agents/business/CLAUDE.md`

**Step 1: Create bot via @BotFather** (e.g. `@PromanBusinessBot`)

**Step 2: Create agent.yaml**

```yaml
name: Business
description: Construction project management agent. Email processing, knowledge base, JBCC contracts, project sync.

telegram_bot_token_env: BUSINESS_BOT_TOKEN

model: claude-opus-4-6

cwd: ~/business-os
```

**Step 3: Write CLAUDE.md**

This should be a slim version of business-os's existing CLAUDE.md, focused on Telegram interaction. It should reference the existing commands (`/process-email`, `/sync-project`, etc.) and know about the 12_Knowledge folder structure. Pull key sections from `~/business-os/.claude/CLAUDE.md`.

**Step 4: Add BUSINESS_BOT_TOKEN to .env**

**Step 5: Commit**

```bash
git add agents/business/
git commit -m "feat: add Business agent (construction PM)"
```

---

## Task 4: Create Content-OS Agent

**Files:**
- Create: `agents/content/agent.yaml`
- Create: `agents/content/CLAUDE.md`

**Step 1: Create bot via @BotFather** (e.g. `@PromanContentBot`)

**Step 2: Create agent.yaml**

```yaml
name: Content
description: LinkedIn content creation agent. Content radar, post production, publishing pipeline.

telegram_bot_token_env: CONTENT_BOT_TOKEN

model: claude-sonnet-4-6

cwd: ~/content-creation-os
```

**Step 3: Write CLAUDE.md**

Focused on content creation workflows: content radar, carousel production, publishing, feedback loops. Reference content-os's existing skills and commands.

**Step 4: Add CONTENT_BOT_TOKEN to .env**

**Step 5: Commit**

```bash
git add agents/content/
git commit -m "feat: add Content agent (LinkedIn content)"
```

---

## Task 5: Set Up Agent Launchd Services on Mini

Each agent runs as a separate process on the Mini, each with its own launchd plist.

**Files:**
- Create: `~/Library/LaunchAgents/com.claudeclaw.reef.plist`
- Create: `~/Library/LaunchAgents/com.claudeclaw.business.plist`
- Create: `~/Library/LaunchAgents/com.claudeclaw.content.plist`

**Step 1: Create plist for each agent**

Same structure as `com.claudeclaw.app.plist` but with:
- Label: `com.claudeclaw.{agent}`
- ProgramArguments: `node /Users/home/claudeclaw/dist/index.js --agent {agent}`
- StandardOutPath: `/tmp/claudeclaw-{agent}.log`
- StandardErrorPath: `/tmp/claudeclaw-{agent}.err`

**Step 2: Load all three**

```bash
ssh mini "launchctl load ~/Library/LaunchAgents/com.claudeclaw.reef.plist"
ssh mini "launchctl load ~/Library/LaunchAgents/com.claudeclaw.business.plist"
ssh mini "launchctl load ~/Library/LaunchAgents/com.claudeclaw.content.plist"
```

**Step 3: Verify all running**

```bash
ssh mini "launchctl list | grep claudeclaw"
```

Expected: 4 processes (main, reef, business, content).

**Step 4: Test each bot**

Send a message to each bot in Telegram. Verify they respond and are working in the correct cwd.

---

## Task 6: Migrate Reef Credentials

**Step 1: Get credentials from VPS**

```bash
ssh reef "cat ~/.openclaw/credentials/*.json 2>/dev/null; openclaw config get env.vars 2>/dev/null"
```

Extract:
- REMAX_HUB_EMAIL
- REMAX_HUB_PASSWORD
- HUBSPOT_ACCESS_TOKEN
- GOOGLE_SERVICE_ACCOUNT_JSON
- GOOGLE_SHEET_ID

**Step 2: Add to ClaudeClaw .env on Mini**

Don adds these manually (security hook).

**Step 3: Set up Python deps on Mini**

```bash
ssh mini "pip3 install google-auth google-auth-oauthlib google-api-python-client requests"
```

Or use a `requirements.txt` in the reef skills directory.

**Step 4: Set up browser profile for REMAX Hub on Mini**

The VPS uses `agent-browser` with a persistent Chrome profile. On Mini, we can use Playwright MCP instead, OR install `agent-browser`. Decision point for Don.

**Step 5: Test pipeline check**

```bash
ssh mini "cd ~/reef-agent/workspace-reef/skills/pipeline && python3 pipeline.py check"
```

---

## Task 7: Migrate PAI Crons to ClaudeClaw Tasks

### MacBook Crons (current)

| Cron | Freq | Action |
|------|------|--------|
| google-token-keepalive | 3:55am daily | Keep. Auth maintenance. |
| prune-repo | 1pm daily | Keep on MacBook. Local cleanup. |
| log-rotation-laptop | 1pm Sundays | Keep on MacBook. Local cleanup. |
| audit-views (business-os) | 5am daily | Move to ClaudeClaw business agent scheduled task |
| memory-commit | 6pm Fridays | Keep or move to ClaudeClaw task |
| git-auto-sync | every 15min | Keep. Core infra. |
| memory-health | every 6h | Move to ClaudeClaw task or keep |
| repo-audit | every 6h | Keep. Infra maintenance. |
| memory-reindex | 1am daily | Keep or move |
| cron-watchdog | 5am daily | Keep. Self-monitoring. |
| learning-automation | 11:35pm daily | Keep or move |

### Mini Crons (current)

| Cron | Freq | Action |
|------|------|--------|
| git-auto-sync | every 15min | Keep. Core infra. |
| content-os-health | 6:10am daily | Move to ClaudeClaw content agent task |
| feedback-ops | every 6h | Move to ClaudeClaw content agent task |
| feedback-weekly | 7:35am Mondays | Move to ClaudeClaw content agent task |

### Recommendation

Keep bash crons for infrastructure (git sync, token keepalive, log rotation, watchdog). Move domain-specific crons (audit-views, content-os-health, feedback-ops) into ClaudeClaw scheduled tasks on the relevant agent. This consolidates domain work under the agent that owns it.

---

## Task 8: Retire OpenClaw on Mac Mini

**Step 1: Stop all OpenClaw services**

```bash
ssh mini "launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist 2>/dev/null"
ssh mini "launchctl unload ~/Library/LaunchAgents/com.openclaw.watchdog.plist 2>/dev/null"
ssh mini "launchctl unload ~/Library/LaunchAgents/com.proman.atlashq.plist 2>/dev/null"
ssh mini "launchctl unload ~/Library/LaunchAgents/com.lima.dons-openclaw.plist 2>/dev/null"
```

**Step 2: Verify no OpenClaw processes running**

```bash
ssh mini "launchctl list | grep -i openclaw; ps aux | grep -i openclaw"
```

**Step 3: Archive (don't delete yet)**

```bash
ssh mini "mv ~/.openclaw ~/.openclaw.retired-$(date +%Y%m%d)"
```

**Step 4: Remove OpenClaw-related crons from Mini crontab**

If any remain after migration.

**Step 5: Verify ClaudeClaw agents are handling all workloads**

Run for 48 hours, check logs, confirm all scheduled tasks fire correctly.

---

## Task 9: Retire VPS

**Prerequisites:** Reef agent running on Mini, pipeline tested, credentials migrated.

**Step 1: Final backup of VPS**

```bash
scp -r reef:~/reef-agent ~/backups/reef-agent-vps-backup-$(date +%Y%m%d)
```

**Step 2: Verify reef-agent repo is on GitHub**

```bash
gh repo view Devine143/reef-agent --json name
```

**Step 3: Remove SSH config entry** (optional, keep for reference)

**Step 4: Cancel Hetzner VPS**

Don does this manually via Hetzner console.

---

## Execution Order

1. Task 1 (agent cwd support) -- unblocks everything
2. Task 2 (Reef agent) + Task 6 (credentials) -- in parallel
3. Task 3 (Business agent) + Task 4 (Content agent) -- in parallel
4. Task 5 (launchd services on Mini)
5. Task 7 (migrate crons) -- after agents are running
6. Task 8 (retire OpenClaw Mini) -- after 48h burn-in
7. Task 9 (retire VPS) -- after Reef pipeline tested end-to-end

## Risk Mitigations

- **Don't delete anything until replacements are verified.** Archive first.
- **Test each agent individually before moving to the next.**
- **REMAX Hub browser automation** is the riskiest migration. The VPS uses `agent-browser` with a persistent Chrome profile. On Mini, Playwright MCP may work differently. Test this early.
- **Credentials in .env** means all agents share one .env file. Namespace env vars clearly (REEF_REMAX_HUB_EMAIL, etc.) to avoid collisions.
- **Each agent is a separate Telegram bot.** Don needs to create 3 new bots via @BotFather. This is a one-time setup step.
