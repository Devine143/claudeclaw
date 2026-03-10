import fs from 'fs';
import path from 'path';

import { GrammyError } from 'grammy';

import { loadAgentConfig } from './agent-config.js';
import { createBot } from './bot.js';
import { ALLOWED_CHAT_ID, activeBotToken, STORE_DIR, PROJECT_ROOT, setAgentOverrides } from './config.js';
import { startDashboard } from './dashboard.js';
import { initDatabase } from './db.js';
import { logger } from './logger.js';
import { cleanupOldUploads } from './media.js';
import { runDecaySweep } from './memory.js';
import { initScheduler } from './scheduler.js';
import { setTelegramConnected, setBotInfo } from './state.js';

// Parse --agent flag
const agentFlagIndex = process.argv.indexOf('--agent');
const AGENT_ID = agentFlagIndex !== -1 ? process.argv[agentFlagIndex + 1] : 'main';

if (AGENT_ID !== 'main') {
  const agentConfig = loadAgentConfig(AGENT_ID);
  const agentDir = path.join(PROJECT_ROOT, 'agents', AGENT_ID);
  const claudeMdPath = path.join(agentDir, 'CLAUDE.md');
  let systemPrompt: string | undefined;
  try {
    systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
  } catch { /* no CLAUDE.md */ }
  setAgentOverrides({
    agentId: AGENT_ID,
    botToken: agentConfig.botToken,
    cwd: agentConfig.cwd || agentDir,
    model: agentConfig.model,
    obsidian: agentConfig.obsidian,
    systemPrompt,
    timeoutMs: agentConfig.timeoutMs,
  });
  logger.info({ agentId: AGENT_ID, name: agentConfig.name }, 'Running as agent');
}

const PID_FILE = path.join(STORE_DIR, `${AGENT_ID === 'main' ? 'claudeclaw' : `agent-${AGENT_ID}`}.pid`);

function showBanner(): void {
  const bannerPath = path.join(PROJECT_ROOT, 'banner.txt');
  try {
    const banner = fs.readFileSync(bannerPath, 'utf-8');
    console.log('\n' + banner);
  } catch {
    console.log('\n  ClaudeClaw\n');
  }
}

function acquireLock(): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  try {
    if (fs.existsSync(PID_FILE)) {
      const old = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (!isNaN(old) && old !== process.pid) {
        try {
          process.kill(old, 'SIGTERM');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        } catch { /* already dead */ }
      }
    }
  } catch { /* ignore */ }
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function releaseLock(): void {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

async function main(): Promise<void> {
  if (AGENT_ID === 'main') {
    showBanner();
  }

  if (!activeBotToken) {
    logger.error('Bot token is not set. Add TELEGRAM_BOT_TOKEN (or agent token) to .env and restart.');
    process.exit(1);
  }

  acquireLock();

  initDatabase();
  logger.info('Database ready');

  runDecaySweep();
  setInterval(() => runDecaySweep(), 24 * 60 * 60 * 1000);

  cleanupOldUploads();

  const bot = createBot();

  // Dashboard only runs in the main bot process
  if (AGENT_ID === 'main') {
    startDashboard(bot.api);
  }

  if (ALLOWED_CHAT_ID) {
    initScheduler(
      (text) => bot.api.sendMessage(ALLOWED_CHAT_ID, text, { parse_mode: 'HTML' }).then(() => {}).catch((err) => logger.error({ err }, 'Scheduler failed to send message')),
      AGENT_ID,
    );
  } else {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler disabled (no destination for results)');
  }

  const shutdown = async () => {
    logger.info('Shutting down...');
    setTelegramConnected(false);
    releaseLock();
    await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  logger.info({ agentId: AGENT_ID }, 'Starting ClaudeClaw...');

  // Clear any stale Telegram polling session from a previous crash.
  // Without this, a fast restart hits 409 Conflict because Telegram's
  // long-poll from the dead process hasn't timed out yet (~30s).
  await bot.api.deleteWebhook({ drop_pending_updates: false });

  // Retry loop: if we still hit a 409 after deleteWebhook (e.g. rapid
  // launchd respawn while Telegram hasn't released the old session),
  // wait with backoff and retry instead of crash-looping.
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await bot.start({
        drop_pending_updates: attempt > 0,
        onStart: (botInfo) => {
          setTelegramConnected(true);
          setBotInfo(botInfo.username ?? '', botInfo.first_name ?? 'ClaudeClaw');
          logger.info({ username: botInfo.username }, 'ClaudeClaw is running');
          if (AGENT_ID === 'main') {
            console.log(`\n  ClaudeClaw online: @${botInfo.username}`);
            console.log(`  Send /chatid to get your chat ID for ALLOWED_CHAT_ID\n`);
          } else {
            console.log(`\n  ClaudeClaw agent [${AGENT_ID}] online: @${botInfo.username}\n`);
          }
        },
      });
      break; // bot.start() resolved (bot stopped gracefully)
    } catch (err: unknown) {
      const is409 = err instanceof GrammyError && err.error_code === 409;
      if (is409 && attempt < MAX_RETRIES) {
        const delay = Math.min(5000 * (attempt + 1), 30000);
        logger.warn({ attempt: attempt + 1, delay }, 'Telegram 409 conflict — retrying after delay');
        try { await bot.stop(); } catch { /* already stopped */ }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err; // non-409 or exhausted retries
    }
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error');
  releaseLock();
  process.exit(1);
});
