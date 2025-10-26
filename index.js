const { Telegraf } = require('telegraf');
const express = require('express');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;  // From Vercel env
const LEADER_USERNAME = 'BasedPing_bot';  // Replace with your @handle (no @)
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());


// NEW: CORS fix for local dev (allows localhost to fetch API without browser block)
const cors = require('cors');
app.use(cors({ origin: '*' }));  // '*' = allow all origins (localhost + prod)

// Subscribers: {userId: {risk: number, ref: string}}
let subscribers = {};

// Subscribe command with ref check
bot.command('subscribe', (ctx) => {
  const messageText = ctx.message.text;
  const refMatch = messageText.match(/ref=([A-Z]+)/);  // e.g., /subscribe?ref=GODSEYE
  const ref = refMatch ? refMatch[1] : null;
  if (ref !== 'GODSEYE') {  // Your referral code
    ctx.reply('Invalid referral. Join via leader link.');
    return;
  }
  const userId = ctx.from.id;
  subscribers[userId] = { userId, risk: 0.5, ref };
  console.log('New sub added:', userId, 'risk:', 0.5, 'ref:', ref);
  ctx.reply(`Subscribed with ref ${ref}! Set risk with /risk 0.5.`);
});

// Unsubscribe
bot.command('unsubscribe', (ctx) => {
  const userId = ctx.from.id;
  delete subscribers[userId];
  ctx.reply('Unsubscribed.');
});

// Risk set
bot.command('risk', (ctx) => {
  const userId = ctx.from.id;
  const parts = ctx.message.text.split(' ');
  const risk = parseFloat(parts[1]) || 0.5;
  if (subscribers[userId]) {
    subscribers[userId].risk = Math.min(Math.max(risk, 0.1), 2);
    ctx.reply(`Risk set to ${subscribers[userId].risk}x.`);
  } else {
    ctx.reply('Subscribe first with /subscribe?ref=GODSEYE.');
  }
});

// Parse group messages for signals (only from leader)
bot.on('text', async (ctx) => {
  if (ctx.message.text.includes('New Trade Alert!') && ctx.from.username === LEADER_USERNAME) {
    console.log('Webhook hit—leader:', ctx.from.username, 'text preview:', ctx.message.text.substring(0, 100));
    const spoilerMatch = ctx.message.text.match(/<tg-spoiler>SIGNAL: ({.*})<\/tg-spoiler>/);
    if (spoilerMatch) {
      console.log('Spoiler parsed:', spoilerMatch[1].substring(0, 50) + '...');
      try {
        const signal = JSON.parse(spoilerMatch[1]);
        if (verifySignal(signal)) {
          const signalId = crypto.randomUUID();
          // Store real signals per sub (in-memory array for now)
          Object.values(subscribers).forEach(sub => {
            if (!sub.signals) sub.signals = [];
            sub.signals.push({ ...signal, id: signalId });
            bot.telegram.sendMessage(sub.userId, `Auto-Signal: ${JSON.stringify(signal)}`);  // App polls this
          });
          console.log(`Signal broadcast to ${Object.keys(subscribers).length} subscribers:`, signal);
        }
      } catch (e) {
        console.error('Signal parse error:', e.message);
        return;  // Invalid JSON, skip
      }
    } else {
      console.log('No spoiler match in text');
    }
  }
});

function verifySignal(signal) {
  return signal.signature === 'GODSEYE-HASH-ABC123';  // Match leader's hash
}

// Vercel API endpoint for app polling (follower fetches pending signals)
app.get('/api/signals', (req, res) => {
  const userId = req.query.userId;
  const sub = Object.values(subscribers).find(s => s.userId == userId);
  const pending = sub ? (sub.signals || []) : [];
  res.json(pending);  // Array of signals for this user
});

app.delete('/api/signals/:id', (req, res) => {
  const id = req.params.id;
  // Dummy delete
  res.json({ success: true });
});

// Webhook for Telegram (Vercel URL + /webhook)
app.use(bot.webhookCallback('/webhook'));

// Vercel default export (fixes 500)
module.exports = app;