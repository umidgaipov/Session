#!/usr/bin/env node
/**
 * scripts/notify_telegram.mjs
 * 
 * Zero-dependency Telegram notification script for Session test platform deployment.
 * Supports:
 *   1. Local execution: reads BOT_TOKEN and GROUP_CHAT_ID from `D:\projects\kmmt admin\.env`.
 *   2. CI/CD execution: falls back to process.env (BOT_TOKEN / TELEGRAM_BOT_TOKEN, etc.).
 * Uses native Node.js fetch (v18+).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to mask secrets in output
function maskSecret(str) {
  if (!str || typeof str !== 'string') return '***';
  if (str.length <= 8) return '***';
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

// Sanitize text containing token from logs
function sanitize(text, token) {
  if (!text || !token) return text;
  return String(text).replaceAll(token, '[REDACTED_BOT_TOKEN]');
}

// Simple robust .env parser
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// Resolve deployment site URL
function resolveSiteUrl(projectRoot, cliUrl) {
  if (cliUrl) return cliUrl;

  // Check CNAME file
  const cnamePath = path.join(projectRoot, 'CNAME');
  if (fs.existsSync(cnamePath)) {
    const domain = fs.readFileSync(cnamePath, 'utf8').trim();
    if (domain) {
      return domain.startsWith('http') ? domain : `https://${domain}`;
    }
  }

  // Default fallback to GitHub Pages repo URL
  return 'https://umidgaipov.github.io/Session/';
}

// Parse CLI flags
function parseArgs(args) {
  const flags = {
    dryRun: false,
    url: null,
    envPath: 'D:\\projects\\kmmt admin\\.env',
    chatId: null,
    target: 'group', // 'group', 'admin', 'all'
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--url' && args[i + 1]) {
      flags.url = args[++i];
    } else if (arg === '--env-path' && args[i + 1]) {
      flags.envPath = args[++i];
    } else if (arg === '--chat-id' && args[i + 1]) {
      flags.chatId = args[++i];
    } else if (arg === '--target' && args[i + 1]) {
      flags.target = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    }
  }

  return flags;
}

// Send request to Telegram Bot API with timeout
async function callTelegramApi(token, method, payload = null, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const options = {
      signal: controller.signal,
      headers: {}
    };

    if (payload) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    } else {
      options.method = 'GET';
    }

    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      const desc = data?.description || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Telegram API [${method}] failed: ${desc}`);
    }

    return data.result;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Telegram API [${method}] timed out after ${timeoutMs}ms`);
    }
    throw new Error(sanitize(err.message, token));
  } finally {
    clearTimeout(timer);
  }
}

// Build notification message text in HTML
function buildMessage(siteUrl) {
  const dateStr = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return [
    `🚀 <b>Платформа тестирования по экономической статистике опубликована!</b>`,
    ``,
    `📱 <b>Сайт доступен онлайн:</b>`,
    `👉 <a href="${siteUrl}">${siteUrl}</a>`,
    ``,
    `📊 <b>Особенности релиза:</b>`,
    `• <b>152 вопроса</b> (95 ситуационных кейсов + 57 расчетных задач)`,
    `• Мобильный интерфейс <i>«Quiet Confidence»</i> & тактильная эргономика`,
    `• <b>Offline-First</b>: 100% PWA-автономность для работы в метро`,
    `• Интерактивный методологический разбор и аналитика ловушек`,
    `• Локальное автосохранение прогресса в LocalStorage`,
    ``,
    `⏱ <i>Время деплоя: ${dateStr} (Tashkent)</i>`
  ].join('\n');
}

// Main execution flow
async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: node scripts/notify_telegram.mjs [options]

Options:
  --dry-run          Validate credentials and message format without sending
  --url <url>        Override deployed site URL
  --env-path <path>  Path to .env file (default: D:\\projects\\kmmt admin\\.env)
  --chat-id <id>     Directly specify chat ID
  --target <target>  Destination: group | admin | all (default: group)
  --help, -h         Show this help message
`);
    process.exit(0);
  }

  // Find project root
  const projectRoot = path.resolve(__dirname, '..');
  const siteUrl = resolveSiteUrl(projectRoot, flags.url);

  console.log(`[Telegram Notify] Initializing...`);

  // Load from .env or process.env
  let fileEnv = null;
  if (fs.existsSync(flags.envPath)) {
    console.log(`[Telegram Notify] Loading credentials from file: ${flags.envPath}`);
    fileEnv = parseEnvFile(flags.envPath);
  } else {
    console.log(`[Telegram Notify] Env file not found at ${flags.envPath}; checking process.env...`);
  }

  const botToken = fileEnv?.BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error(`[Telegram Notify] ERROR: BOT_TOKEN is missing (not in ${flags.envPath} and not in process.env)`);
    process.exit(1);
  }

  console.log(`[Telegram Notify] BOT_TOKEN found: ${maskSecret(botToken)} (length: ${botToken.length})`);

  const groupChatId = fileEnv?.GROUP_CHAT_ID || process.env.GROUP_CHAT_ID || process.env.TELEGRAM_GROUP_CHAT_ID;
  const adminId = fileEnv?.ADMIN_ID || process.env.ADMIN_ID || process.env.TELEGRAM_ADMIN_ID;

  // Determine recipients
  const recipients = [];
  if (flags.chatId) {
    recipients.push({ type: 'custom', id: flags.chatId });
  } else {
    if ((flags.target === 'group' || flags.target === 'all') && groupChatId) {
      recipients.push({ type: 'group', id: groupChatId });
    }
    if ((flags.target === 'admin' || flags.target === 'all') && adminId) {
      recipients.push({ type: 'admin', id: adminId });
    }
  }

  if (recipients.length === 0) {
    console.error(`[Telegram Notify] ERROR: No valid recipient chat ID found in .env or environment.`);
    console.error(`Please provide GROUP_CHAT_ID / ADMIN_ID in .env or pass --chat-id <id>.`);
    process.exit(1);
  }

  // Step 1: Verify Bot via getMe
  console.log(`[Telegram Notify] Verifying bot via getMe...`);
  let botInfo;
  try {
    botInfo = await callTelegramApi(botToken, 'getMe');
    console.log(`[Telegram Notify] Bot verified: @${botInfo.username} (${botInfo.first_name}, ID: ${botInfo.id})`);
  } catch (err) {
    console.error(`[Telegram Notify] ERROR: Bot verification failed: ${err.message}`);
    process.exit(2);
  }

  const messageText = buildMessage(siteUrl);

  if (flags.dryRun) {
    console.log(`\n[Telegram Notify] [DRY RUN] Message ready to send to ${recipients.length} destination(s):`);
    for (const r of recipients) {
      console.log(`  -> Recipient [${r.type}]: ${r.id}`);
    }
    console.log(`\n--- Message Content ---\n${messageText}\n------------------------\n`);
    console.log(`[Telegram Notify] DRY RUN completed successfully. No messages sent.`);
    process.exit(0);
  }

  // Step 2: Send message to each recipient
  let successCount = 0;
  for (const r of recipients) {
    console.log(`[Telegram Notify] Sending message to [${r.type}] ${r.id}...`);
    try {
      const sent = await callTelegramApi(botToken, 'sendMessage', {
        chat_id: r.id,
        text: messageText,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });
      console.log(`[Telegram Notify] SUCCESS: Message delivered to ${r.id} (message_id: ${sent.message_id})`);
      successCount++;
    } catch (err) {
      console.error(`[Telegram Notify] FAILED to deliver to ${r.id}: ${err.message}`);
    }
  }

  if (successCount === 0) {
    console.error(`[Telegram Notify] ERROR: All deliveries failed.`);
    process.exit(2);
  }

  console.log(`[Telegram Notify] Notification complete! (${successCount}/${recipients.length} delivered)`);
}

main().catch(err => {
  console.error(`[Telegram Notify] Fatal error: ${err.message}`);
  process.exit(1);
});
