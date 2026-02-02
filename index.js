require("dotenv").config();

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const {
   Client,
   GatewayIntentBits,
   REST,
   Routes,
   SlashCommandBuilder
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DAILY_CHANNEL_ID = process.env.DAILY_CHANNEL_ID;
const PING_ROLE_ID = process.env.PING_ROLE_ID;
const TIMEZONE = process.env.TIMEZONE || "UTC";
const DATA_FILE = path.join(__dirname, "data.json");

const DEFAULT_PROFILE = {
   xp: 0,
   level: 1,
   tasks: [],
   history: []
};

const DEFAULT_META = {
   timers: []
};

const DAILY_TASKS = [
   { text: "Gacha Dailies", xp: 5 }
];

const loadData = () => {
   if (!fs.existsSync(DATA_FILE)) {
      return { users: {}, meta: {} };
   }

   try{
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      return JSON.parse(raw);
   } catch {
      return { users: {}, meta: {} };
   }
};

const saveData = (data) => {
   fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const getUserProfile = (data, userId) => {
   if (!data.users[userId]) {
      data.users[userId] = { ...DEFAULT_PROFILE };
   }

   return data.users[userId];
};

const calculateLevel = (xp) => {
   return Math.floor(xp / 100) + 1;
};

const getTodayKey = () => {
   return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
};

const checkTimers = async (clientInstance) => {
   const data = loadData();
   data.meta = data.meta || DEFAULT_META;
   const now = new Date();
   const timers = data.meta.timers || [];
   const timersCopy = [...timers];

   for (let i = timersCopy.length - 1; i >= 0; i--) {
      const timer = timersCopy[i];
      const eventTime = new Date(timer.timestamp);

      const msUntilEvent = eventTime - now;
      const hoursUntil = msUntilEvent / (1000 * 60 * 60);
      const minutesUntil = msUntilEvent / (1000 * 60);

      const user = await clientInstance.users.fetch(timer.userId).catch(() => null);
      if (!user) continue;

      if (!timer.notified12h && hoursUntil <= 12 && hoursUntil > 11.9) {
         await user.send(`⏰ **12 hours until "${timer.name}"**`).catch(() => {});
         timer.notified12h = true;
         data.meta.timers = timersCopy;
         saveData(data);
      }

      if (!timer.notified30m && minutesUntil <= 30 && minutesUntil > 29.9) {
         await user.send(`⏰ **30 minutes until "${timer.name}"**`).catch(() => {});
         timer.notified30m = true;
         data.meta.timers = timersCopy;
         saveData(data);
      }

      if (msUntilEvent <= 0 && !timer.notifiedExact) {
         await user.send(`🔔 **Event now: "${timer.name}"**`).catch(() => {});
         timer.notifiedExact = true;
         data.meta.timers = timersCopy;
         saveData(data);
      }

      if (msUntilEvent < -60000) {
         timersCopy.splice(i, 1);
         data.meta.timers = timersCopy;
         saveData(data);
      }
   }
};

const runDailyTasks = async (clientInstance) => {
   if (!DAILY_CHANNEL_ID) {
      console.log("Missing DAILY_CHANNEL_ID in .env. Skipping daily task post.");
      return;
   }

   const data = loadData();
   const todayKey = getTodayKey();

   if (data.meta?.lastDailyDate === todayKey) {
      return;
   }

   data.meta = data.meta || {};
   data.meta.lastDailyDate = todayKey;

   Object.values(data.users).forEach((profile) => {
      if (!profile || !Array.isArray(profile.tasks)) return;

      const nextId = profile.tasks.length ? Math.max(...profile.tasks.map((t) => t.id)) + 1 : 1;
      DAILY_TASKS.forEach((task, index) => {
         profile.tasks.push({
            id: nextId + index,
            text: task.text,
            xp: task.xp,
            done: false,
            daily: true,
            date: todayKey
         });
      });
   });

   saveData(data);

   try {
      const channel = await clientInstance.channels.fetch(DAILY_CHANNEL_ID);
      if (!channel) return;

      const mention = PING_ROLE_ID ? `<@&${PING_ROLE_ID}>` : "@everyone";
      const taskLines = DAILY_TASKS.map((task) => `• ${task.text} (${task.xp} XP)`).join("\n");
      await channel.send({
         content: `${mention} Daily tasks are live!\n${taskLines}`,
         allowedMentions: PING_ROLE_ID ? { roles: [PING_ROLE_ID] } : { parse: ["everyone"] }
      });
   } catch (error) {
      console.error("Failed to post daily tasks.", error);
   }
};

const commandDefinitions = [
   new SlashCommandBuilder()
      .setName("hello")
      .setDescription("Say hello"),
   new SlashCommandBuilder()
      .setName("add")
      .setDescription("Add a task")
      .addStringOption((option) =>
         option
            .setName("description")
            .setDescription("Task description")
            .setRequired(true)
      )
      .addIntegerOption((option) =>
         option
            .setName("xp")
            .setDescription("XP awarded (default 10)")
            .setRequired(false)
      ),
   new SlashCommandBuilder()
      .setName("list")
      .setDescription("List your tasks"),
   new SlashCommandBuilder()
      .setName("done")
      .setDescription("Complete a task")
      .addIntegerOption((option) =>
         option
            .setName("id")
            .setDescription("Task ID")
            .setRequired(true)
      ),
   new SlashCommandBuilder()
      .setName("history")
      .setDescription("Show your last 100 completed tasks"),
   new SlashCommandBuilder()
      .setName("timer")
      .setDescription("Timer/Event commands")
      .addSubcommand((subcommand) =>
         subcommand
            .setName("add")
            .setDescription("Add an event/timer")
            .addStringOption((option) =>
               option
                  .setName("name")
                  .setDescription("Event name")
                  .setRequired(true)
            )
            .addStringOption((option) =>
               option
                  .setName("time")
                  .setDescription("Time in format YYYY-MM-DD HH:MM (24-hour)")
                  .setRequired(true)
            )
            .addStringOption((option) =>
               option
                  .setName("description")
                  .setDescription("Event description (optional)")
                  .setRequired(false)
            )
      )
      .addSubcommand((subcommand) =>
         subcommand
            .setName("list")
            .setDescription("List your timers")
      )
      .addSubcommand((subcommand) =>
         subcommand
            .setName("delete")
            .setDescription("Delete a timer")
            .addIntegerOption((option) =>
               option
                  .setName("id")
                  .setDescription("Timer ID")
                  .setRequired(true)
            )
      ),
   new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show your status screen"),
   new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show available commands")
].map((command) => command.toJSON());

const registerCommands = async () => {
   if (!CLIENT_ID) {
      console.log("Missing CLIENT_ID in .env. Slash commands were not registered.");
      return;
   }

   const rest = new REST({ version: "10" }).setToken(TOKEN);

   try {
      if (GUILD_ID) {
         await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
            body: commandDefinitions
         });
         console.log("Registered guild slash commands.");
      } else {
         await rest.put(Routes.applicationCommands(CLIENT_ID), {
            body: commandDefinitions
         });
         console.log("Registered global slash commands.");
      }
   } catch (error) {
      console.error("Failed to register slash commands.", error);
   }
};

const client = new Client({
   intents: [
      GatewayIntentBits.Guilds
   ]
});

client.once("clientReady", () => {
   console.log(`Logged in as ${client.user.tag}`);
   registerCommands();

   runDailyTasks(client);

   if (DAILY_CHANNEL_ID) {
      client.channels.fetch(DAILY_CHANNEL_ID)
         .then((channel) => {
            if (!channel) return;
            channel.send("Welcome back, Doctor");
         })
         .catch((error) => console.error("Failed to send welcome message.", error));
   }

   cron.schedule(
      "0 4 * * *",
      () => {
         runDailyTasks(client);
      },
      { timezone: TIMEZONE }
   );

   cron.schedule(
      "*/1 * * * *",
      () => {
         checkTimers(client);
      }
   );
});

client.on("interactionCreate", async (interaction) => {
   if (!interaction.isChatInputCommand()) return;

   const data = loadData();
   const profile = getUserProfile(data, interaction.user.id);

   if (interaction.commandName === "hello") {
      await interaction.reply("World!");
      return;
   }

   if (interaction.commandName === "add") {
      const description = interaction.options.getString("description", true);
      const exp = interaction.options.getInteger("xp") ?? 10;

      if (exp <= 0) {
         await interaction.reply("XP must be a positive number.");
         return;
      }

      const nextId = profile.tasks.length ? Math.max(...profile.tasks.map((t) => t.id)) + 1 : 1;
      profile.tasks.push({ id: nextId, text: description, xp: exp, done: false });
      saveData(data);

      await interaction.reply(`Added task #${nextId} for ${exp} XP.`);
      return;
   }

   if (interaction.commandName === "list") {
      const activeTasks = profile.tasks.filter((task) => !task.done);
      if (activeTasks.length === 0) {
         await interaction.reply("No tasks yet. Add one with /add.");
         return;
      }

      const lines = activeTasks
         .map((task) => {
            return `🟡 #${task.id} • ${task.text} (${task.xp} XP)`;
         })
         .join("\n");

      await interaction.reply(`**Your Tasks**\n${lines}`);
      return;
   }

   if (interaction.commandName === "done") {
      const taskId = interaction.options.getInteger("id", true);
      const task = profile.tasks.find((t) => t.id === taskId);

      if (!task) {
         await interaction.reply("Task not found.");
         return;
      }

      if (task.done) {
         await interaction.reply("That task is already completed.");
         return;
      }

      task.done = true;
      profile.xp += task.xp;
      profile.level = calculateLevel(profile.xp);

      profile.history = profile.history || [];
      profile.history.unshift({
         id: task.id,
         text: task.text,
         xp: task.xp,
         completedAt: new Date().toISOString()
      });
      profile.history = profile.history.slice(0, 100);

      saveData(data);

      await interaction.reply(`Completed task #${task.id}! You earned ${task.xp} XP.`);
      return;
   }

   if (interaction.commandName === "history") {
      const history = profile.history || [];

      if (history.length === 0) {
         await interaction.reply("No completed tasks yet.");
         return;
      }

      const lines = history
         .slice(0, 100)
         .map((item, index) => `#${index + 1} • ${item.text} (${item.xp} XP)`)
         .join("\n");

      await interaction.reply(`**Completed Tasks (last ${Math.min(history.length, 100)})**\n${lines}`);
      return;
   }

   if (interaction.commandName === "status") {
      const completed = profile.tasks.filter((t) => t.done).length;
      const total = profile.tasks.length;
      const nextLevelXp = profile.level * 100;
      const barSize = 10;
      const progress = Math.min(profile.xp / nextLevelXp, 1);
      const filled = Math.round(progress * barSize);
      const bar = "█".repeat(filled) + "░".repeat(barSize - filled);

      const statusLines = [
         "```",
         `Player: ${interaction.user.username}`,
         `Level:  ${profile.level}`,
         `XP:     ${profile.xp} / ${nextLevelXp}`,
         `Progress: [${bar}]`,
         `Tasks:  ${completed}/${total} complete`,
         "```"
      ];

      await interaction.reply(statusLines.join("\n"));
      return;
   }

   if (interaction.commandName === "help") {
      await interaction.reply(
         [
            "**Commands**",
            "/add <description> <xp>  → add a task (xp optional, default 10)",
            "/list                    → list tasks",
            "/done <id>               → complete a task and gain XP",
            "/history                 → show last 100 completed tasks",
            "/timer add <name> <time> → add an event (format: YYYY-MM-DD HH:MM)",
            "/timer list              → list your timers",
            "/timer delete <id>       → delete a timer",
            "/status                       → show your status screen",
            "/help                         → show this help",
            "/hello                        → hello world"
         ].join("\n")
      );
   }

   if (interaction.commandName === "timer") {
      const subcommand = interaction.options.getSubcommand();
      data.meta = data.meta || DEFAULT_META;
      data.meta.timers = data.meta.timers || [];

      if (subcommand === "add") {
         const name = interaction.options.getString("name", true);
         const timeStr = interaction.options.getString("time", true);
         const description = interaction.options.getString("description") || "";

         const eventTime = new Date(timeStr);
         if (isNaN(eventTime.getTime())) {
            await interaction.reply("Invalid time format. Use: YYYY-MM-DD HH:MM");
            return;
         }

         const now = new Date();
         if (eventTime <= now) {
            await interaction.reply("Event time must be in the future.");
            return;
         }

         const nextId = data.meta.timers.length ? Math.max(...data.meta.timers.map((t) => t.id)) + 1 : 1;
         data.meta.timers.push({
            id: nextId,
            name,
            description,
            timestamp: eventTime.toISOString(),
            userId: interaction.user.id,
            notified12h: false,
            notified30m: false,
            notifiedExact: false
         });
         saveData(data);

         const displayDesc = description ? `\n${description}` : "";
         await interaction.reply(`Added timer #${nextId}: "${name}" at ${eventTime.toLocaleString()}${displayDesc}`);
         return;
      }

      if (subcommand === "list") {
         const userTimers = data.meta.timers.filter((t) => t.userId === interaction.user.id);
         if (userTimers.length === 0) {
            await interaction.reply("No timers set. Add one with /timer add.");
            return;
         }

         const lines = userTimers
            .map((timer) => {
               const eventTime = new Date(timer.timestamp);
               const desc = timer.description ? ` - ${timer.description}` : "";
               return `#${timer.id} • ${timer.name} at ${eventTime.toLocaleString()}${desc}`;
            })
            .join("\n");

         await interaction.reply(`**Your Timers**\n${lines}`);
         return;
      }

      if (subcommand === "delete") {
         const timerId = interaction.options.getInteger("id", true);
         const timerIndex = data.meta.timers.findIndex((t) => t.id === timerId && t.userId === interaction.user.id);

         if (timerIndex === -1) {
            await interaction.reply("Timer not found.");
            return;
         }

         const deleted = data.meta.timers.splice(timerIndex, 1)[0];
         saveData(data);

         await interaction.reply(`Deleted timer: "${deleted.name}"`);
         return;
      }
   }
});

client.login(TOKEN);
