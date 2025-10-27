import { sql } from '@vercel/postgres';
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

// Subscribe command with ref check
bot.command('subscribe', async (ctx) => {  // Async for await
  const messageText = ctx.message.text;
  const refMatch = messageText.match(/ref=([A-Z]+)/);  // e.g., /subscribe?ref=GODSEYE
  const ref = refMatch ? refMatch[1] : null;
  if (ref !== 'GODSEYE') {  // Your referral code
    ctx.reply('Invalid referral. Join via leader link.');
    return;
  }
  const userId = ctx.from.id;
  try {
    await sql`INSERT INTO subs (user_id, risk, ref) VALUES (${userId}, 0.5, ${ref}) ON CONFLICT (user_id) DO UPDATE SET risk = 0.5, ref = ${ref}`;
    console.log('New sub added to DB:', userId);
  } catch (e) {
    console.error('DB sub error:', e);
  }
  ctx.reply(`Subscribed with ref ${ref}! Set risk with /risk 0.5.`);
});

// Unsubscribe
bot.command('unsubscribe', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { rows } = await sql`DELETE FROM subs WHERE user_id = ${userId} RETURNING *`;
    if (rows.length > 0) {
      await sql`DELETE FROM signals WHERE user_id = ${userId}`;
      ctx.reply('Unsubscribed—signals cleared.');
    } else {
      ctx.reply('Not subscribed.');
    }
  } catch (e) {
    console.error('DB unsubscribe error:', e);
    ctx.reply('Error unsubscribing—try again.');
  }
});

// Risk set
bot.command('risk', async (ctx) => {  // Make async
  const userId = ctx.from.id;
  const parts = ctx.message.text.split(' ');
  const risk = parseFloat(parts[1]) || 0.5;
  if (risk < 0.1 || risk > 2) {
    ctx.reply('Risk must be 0.1-2.0. Usage: /risk 0.5');
    return;
  }
  try {
    const { rows } = await sql`SELECT user_id FROM subs WHERE user_id = ${userId}`;
    if (rows.length === 0) {
      ctx.reply('Subscribe first with /subscribe?ref=GODSEYE.');
      return;
    }
    await sql`UPDATE subs SET risk = ${risk} WHERE user_id = ${userId}`;
    ctx.reply(`Risk set to ${risk}x.`);
  } catch (e) {
    console.error('DB risk error:', e);
    ctx.reply('Error setting risk—try again.');
  }
});

// Parse group messages for signals (only from leader)
bot.on('text', async (ctx) => {
  if (ctx.message.text.includes('New Trade Alert!') && ctx.from.username === LEADER_USERNAME) {
    console.log('Webhook hit—leader:', ctx.from.username, 'text preview:', ctx.message.text.substring(0, 100));
    const spoilerMatch = ctx.message.text.match(/<tg-spoiler>SIGNAL: ({.*})<\/tg-spoiler>/) || ctx.message.text.match(/SIGNAL:\s*({[\s\S]*?})/);
    if (spoilerMatch) {
      console.log('Spoiler parsed:', spoilerMatch[1].substring(0, 50) + '...');
      try {
        const signal = JSON.parse(spoilerMatch[1]);
        if (verifySignal(signal)) {
          const signalId = crypto.randomUUID();
          try {
            const { rows } = await sql`SELECT user_id FROM subs WHERE ref = 'GODSEYE'`;
            for (const sub of rows) {
              await sql`INSERT INTO signals (id, user_id, signal) VALUES (${signalId}, ${sub.user_id}, ${JSON.stringify({ ...signal, id: signalId })})`;  // Separate table for signals
              bot.telegram.sendMessage(sub.user_id, `Auto-Signal: ${JSON.stringify(signal)}`);  // App polls this
            }
            console.log(`Signal broadcast to ${rows.length} subs:`, signal);
          } catch (e) {
            console.error('DB broadcast error:', e);
          }
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
app.get('/api/signals', async (req, res) => {
  const userId = req.query.userId;
  try {
    const { rows } = await sql`SELECT signal FROM signals WHERE user_id = ${userId} ORDER BY id DESC LIMIT 10`;
    res.json(rows.map(r => JSON.parse(r.signal)));
  } catch (e) {
    console.error('DB signals error:', e);
    res.json([]);
  }
});

app.delete('/api/signals/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.query.userId;
  try {
    await sql`DELETE FROM signals WHERE id = ${id} AND user_id = ${userId}`;
    res.json({ success: true });
  } catch (e) {
    console.error('DB delete error:', e);
    res.json({ success: false });
  }
});

// Webhook for Telegram (Vercel URL + /webhook)
app.use(bot.webhookCallback('/webhook'));

// Vercel default export (fixes 500)
module.exports = app;