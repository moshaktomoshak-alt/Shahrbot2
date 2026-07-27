// Telegram bot glue. Runs in the same process as the game server (see
// index.ts) so it can call LobbyManager directly instead of over HTTP —
// simpler than a separate Railway service, and avoids the multi-service
// networking headaches from the previous attempt.
//
// Commands:
//   /newgame  (in a group)      -> creates a lobby locked to that group,
//                                   sends a WebApp button.
//   /play     (in a private DM) -> joins/creates a random matchmaking lobby,
//                                   sends a WebApp button.

import { Bot, InlineKeyboard } from "grammy";
import { LobbyManager } from "../server/LobbyManager.js";

export function startBot(token: string, manager: LobbyManager, publicUrl: string): Bot {
  const bot = new Bot(token);

  bot.command("newgame", async (ctx) => {
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.reply("این دستور فقط داخل گروه کار می‌کنه. برای بازی رندوم تو پی‌وی از /play استفاده کن.");
      return;
    }
    const lobby = manager.createGroupLobby(ctx.chat.id);
    const url = `${publicUrl}/index.html?lobbyId=${lobby.id}`;
    const keyboard = new InlineKeyboard().webApp("🎮 ورود به بازی", url);
    await ctx.reply(
      `بازی جدید ساخته شد! فقط اعضای همین گروه می‌تونن وارد بشن.\nحداکثر ۲۰ نفر — هر وقت آماده بودید بزنید:`,
      { reply_markup: keyboard },
    );
  });

  bot.command("play", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply("برای بازی رندوم، این دستور رو تو پی‌وی من بزن.");
      return;
    }
    const lobby = manager.getOrCreateRandomLobby();
    const url = `${publicUrl}/index.html?lobbyId=${lobby.id}`;
    const keyboard = new InlineKeyboard().webApp("🎲 بازی رندوم", url);
    await ctx.reply(`در حال جستجوی بازیکنان دیگه... همین الان می‌تونی وارد بشی:`, { reply_markup: keyboard });
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام! برای بازی گروهی تو یه گروه /newgame رو بزن، یا اینجا تو پی‌وی /play رو بزن برای بازی رندوم.",
    );
  });

  bot.catch((err) => console.error("Bot error:", err));

  bot.start();
  console.log("Telegram bot started (long polling).");
  return bot;
}
