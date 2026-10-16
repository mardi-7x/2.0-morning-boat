/**
 * Morning Intelligence 2.0
 * AI-Powered Tech News Bot for Cloudflare Workers
 * 
 * Features:
 * - Zero external npm dependencies (Native Fetch)
 * - Gemini & Groq AI processing
 * - Telegram Webhook & Cron Trigger support
 * - Cloudflare KV for subscriber management
 */

export default {
  /**
   * Handle Telegram Webhook Requests
   */
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Morning Intelligence Bot is Running! 🚀", { status: 200 });
    }

    try {
      const payload = await request.json();
      if (!payload.message) return new Response("OK");

      const chatId = payload.message.chat.id;
      const text = payload.message.text || "";

      if (text === "/start") {
        await handleStart(chatId, env);
      } else if (text === "/news" || text === "/report") {
        ctx.waitUntil(handleNewsRequest(chatId, env));
      } else {
        await sendTelegram(chatId, "Command not recognized. Try /news for latest tech briefing! 📰", env.BOT_TOKEN);
      }

      return new Response("OK");
    } catch (err) {
      console.error("Fetch Error:", err);
      return new Response("Error", { status: 500 });
    }
  },

  /**
   * Handle Daily Cron Broadcasts
   */
  async scheduled(event, env, ctx) {
    console.log("Starting daily news broadcast...");
    ctx.waitUntil(broadcastDailyNews(env));
  }
};

/**
 * Handle /start command
 * Saves user to KV with a 7-day subscription trial
 */
async function handleStart(chatId, env) {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await env.BOT_DB.put(`sub_${chatId}`, JSON.stringify({
    chatId,
    subscribedAt: Date.now(),
    expiresAt: expiry,
    daysLeft: 7
  }));

  const msg = "Welcome to Morning Intelligence 2.0! 🚀\n\nYou've been subscribed to daily tech news briefings for 7 days.\n\nUse /news to get an instant report!";
  await sendTelegram(chatId, msg, env.BOT_TOKEN);
}

/**
 * Handle manual news request
 */
async function handleNewsRequest(chatId, env) {
  await sendTelegram(chatId, "Gathering the latest intelligence... 🔎", env.BOT_TOKEN);
  
  const news = await fetchTechNews(env.NEWS_API_KEY);
  if (!news || news.length === 0) {
    return await sendTelegram(chatId, "I couldn't find any fresh tech news right now. Please try again later.", env.BOT_TOKEN);
  }

  const briefing = await generateAIReport(news, env);
  await sendTelegram(chatId, briefing, env.BOT_TOKEN);
}

/**
 * Broadcast daily news to all subscribers
 */
async function broadcastDailyNews(env) {
  const news = await fetchTechNews(env.NEWS_API_KEY);
  if (!news || news.length === 0) return;

  const briefing = await generateAIReport(news, env);
  const { keys } = await env.BOT_DB.list({ prefix: "sub_" });

  for (const key of keys) {
    const data = JSON.parse(await env.BOT_DB.get(key.name));
    const chatId = data.chatId;

    if (data.daysLeft > 0) {
      await sendTelegram(chatId, "☀️ *Morning Intelligence Briefing*\n\n" + briefing, env.BOT_TOKEN);
      
      // Decrement days
      data.daysLeft -= 1;
      if (data.daysLeft === 0) {
        await sendTelegram(chatId, "⚠️ Your subscription has expired. Send /start to renew!", env.BOT_TOKEN);
        await env.BOT_DB.delete(key.name);
      } else {
        await env.BOT_DB.put(key.name, JSON.stringify(data));
      }
    } else {
      await env.BOT_DB.delete(key.name);
    }
  }
}

/**
 * Fetch Technology News from NewsAPI
 */
async function fetchTechNews(apiKey) {
  const url = `https://newsapi.org/v2/top-headlines?category=technology&language=en&pageSize=10&apiKey=${apiKey}`;
  const resp = await fetch(url, { headers: { "User-Agent": "MorningIntelBot/1.0" } });
  const data = await resp.json();
  
  if (data.status !== "ok") return [];
  
  return data.articles
    .filter(a => a.title && a.description)
    .map(a => ({
      title: a.title,
      source: a.source.name,
      description: a.description,
      url: a.url
    }));
}

/**
 * Generate AI Summary using Gemini (Primary) or Groq (Secondary)
 */
async function generateAIReport(articles, env) {
  const prompt = `You are an elite technology news analyst. Summarize these articles into a premium newspaper-style briefing for the last 24 hours. 
  Group them into logical categories (e.g., AI & Robotics, Software & Dev, Hardware, Tech Giants). 
  For each story:
  - Bullet point summary
  - Publisher name
  - Original link
  
  Articles:
  ${JSON.stringify(articles)}
  
  Format the output in clean Markdown for Telegram. No preamble, just the report.`;

  try {
    // Attempt Gemini 1.5 Flash
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    const resp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.warn("Gemini failed, falling back to Groq:", err);
    
    // Fallback to Groq (Llama 3 70B)
    try {
      const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
      const resp = await fetch(groqUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama3-70b-8192",
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await resp.json();
      return data.choices[0].message.content;
    } catch (err2) {
      console.error("AI Generation Failed:", err2);
      return "Morning Intelligence: Error generating report. Please check my AI configurations.";
    }
  }
}

/**
 * Send Message via Telegram Bot API
 */
async function sendTelegram(chatId, text, token) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
      disable_web_page_preview: false
    })
  });
}
