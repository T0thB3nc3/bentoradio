require('dotenv').config();
console.log('TOKEN:', process.env.TOKEN ? '[OK]' : '[HIÁNYZIK]');
console.log('VOICE_CHANNEL_ID:', process.env.VOICE_CHANNEL_ID ? '[OK]' : '[HIÁNYZIK]');

const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, getVoiceConnection } = require('@discordjs/voice');
const { spawn } = require('child_process');
const ffmpegProc = 'ffmpeg';

const TOKEN = process.env.TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const RADIOS_FILE = './radios.json';
const LAST_RADIO_FILE = './last_radio.json';

try {
    if (ffmpegProc) {
        console.log(`[RENDSZER] FFMPEG útvonal: ${ffmpegProc}`);
        // Csak Linux/Mac rendszereken kell, de nem árt
        if (process.platform !== 'win32') {
            console.log('[RENDSZER] Futtatási jogok (chmod +x) beállítása...');
            fs.chmodSync(ffmpegProc, 0o755);
        }
    }
} catch (err) {
    console.error('[RENDSZER HIBA] Nem sikerült a chmod:', err);
}

function loadRadios() {
  try {
    const data = fs.readFileSync(RADIOS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [
      { name: "alapértelmezett", url: "" }
    ];
  }
}
function saveRadios(radios) {
  fs.writeFileSync(RADIOS_FILE, JSON.stringify(radios, null, 2), 'utf8');
}

function loadLastRadioIndex() {
  try {
    return JSON.parse(fs.readFileSync(LAST_RADIO_FILE, 'utf8'));
  } catch {
    return 0;
  }
}
function saveLastRadioIndex(index) {
  fs.writeFileSync(LAST_RADIO_FILE, JSON.stringify(index), 'utf8');
}

let radios = loadRadios();
let currentRadioIndex = loadLastRadioIndex(); // induláskor az utolsó index
let player, connection, ffmpeg;
let joined = false;
let pendingSetChannel = {}; // { userId: { name, link } }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Slash parancsok regisztrálása
const commands = [
  new SlashCommandBuilder().setName('switch').setDescription('Rádióadó váltása').addStringOption(opt => opt.setName('name').setDescription('Rádióadó neve').setRequired(true)),
  new SlashCommandBuilder().setName('join').setDescription('Bot csatlakozik a voice csatornához'),
  new SlashCommandBuilder().setName('leave').setDescription('Bot elhagyja a voice csatornát'),
  new SlashCommandBuilder().setName('add-channel').setDescription('Új rádióadó hozzáadása')
    .addStringOption(opt => opt.setName('name').setDescription('Név').setRequired(true))
    .addStringOption(opt => opt.setName('link').setDescription('Stream link').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // csak admin
  new SlashCommandBuilder().setName('list-channel').setDescription('Elérhető rádióadók listázása'),
  new SlashCommandBuilder().setName('delete-channel').setDescription('Rádióadó törlése')
    .addStringOption(opt => opt.setName('name').setDescription('Név').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // csak admin
  new SlashCommandBuilder().setName('info').setDescription('Rádióadó linkjének lekérdezése').addStringOption(opt => opt.setName('name').setDescription('Név').setRequired(true)),
  new SlashCommandBuilder().setName('set-channel').setDescription('Rádióadó linkjének módosítása')
    .addStringOption(opt => opt.setName('name').setDescription('Név').setRequired(true))
    .addStringOption(opt => opt.setName('link').setDescription('Új link').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // csak admin
  new SlashCommandBuilder().setName('help').setDescription('Parancsok listája és magyarázat')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`Bejelentkezve, mint ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  radios = loadRadios();
  // Automatikus csatlakozás és lejátszás
  await playRadio(currentRadioIndex);
});

// Hibakezelés a login-hoz
client.login(TOKEN).catch(err => {
  console.error('Discord login hiba:', err);
});

async function playRadio(index = 0, interaction = null) {
  if (!radios[index] || !radios[index].url) {
    if (interaction) interaction.reply({ content: 'Nincs ilyen rádió.', ephemeral: true });
    else console.error('Nincs ilyen rádió.');
    return;
  }
  currentRadioIndex = index;
  saveLastRadioIndex(index); // mentés

  let channel = client.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(VOICE_CHANNEL_ID);
      if (!channel) {
        if (interaction) interaction.reply({ content: 'Nem található voice csatorna.', ephemeral: true });
        else console.error('Nem található voice csatorna.');
        return;
      }
    } catch (err) {
      if (interaction) interaction.reply({ content: 'Nem található voice csatorna.', ephemeral: true });
      else console.error('Nem található voice csatorna (fetch sikertelen):', err);
      return;
    }
  }
  if (!channel || (channel.type !== 2 && channel.type !== 'GUILD_VOICE')) {
    if (interaction) interaction.reply({ content: 'A megadott ID nem voice csatorna.', ephemeral: true });
    else console.error('A megadott ID nem voice csatorna. channel.type:', channel?.type);
    return;
  }

  if (connection) connection.destroy();
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator
  });
  joined = true;

  if (ffmpeg) ffmpeg.kill('SIGKILL');

  console.log(`[LEJÁTSZÁS] Indítás: ${radios[index].url}`);

  const ffmpegOptions = {
    stdio: ['ignore', 'pipe', 'pipe']
  };

  if (process.platform === 'win32') {
    ffmpegOptions.windowsHide = true; // Rejtsd el a konzolablakot Windows alatt
  }

  const ffmpegArgs = [
    '-re',
    '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    '-i', radios[index].url,
    '-analyzeduration', '0',
    '-loglevel', 'info',
    '-f', 's16le',  
    '-ar', '48000', 
    '-ac', '2',
    '-b:a', '96k',
    '-bufsize', '2048k',
    'pipe:1'
  ];

  ffmpeg = spawn(ffmpegProc,ffmpegArgs,ffmpegOptions);

  ffmpeg.on('error', (error) => {
    console.error(`[FFMPEG HIBA]: ${error.message}`);
  });
  
  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('403 Forbidden') || msg.includes('Exiting')) {
        console.error(`[FFMPEG ERROR]: ${msg}`);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[FFMPEG] Kilépett. Kód: ${code}`);
  });

  player = createAudioPlayer({
    behaviors: {
      noSubscriber: 'play',
    }
  });
  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    setTimeout(() => {
      if (joined) playRadio(currentRadioIndex);
    }, 1000);
  });

  player.on('error', error => {
    console.error('Hiba a lejátszásban:', error);
    playRadio(currentRadioIndex);
  });

  // Állapot frissítése (bot nicknév)
  try {
    await client.user.setActivity(`🎵 ${radios[index].name}`, { type: 2 });
  } catch (e) {}
}

async function leaveRadio(interaction = null) {
  if (connection) {
    connection.destroy();
    connection = null;
    joined = false;
    if (interaction) interaction.reply('Bot elhagyta a voice csatornát.');
  } else if (interaction) {
    interaction.reply({ content: 'A bot nincs voice csatornában.', ephemeral: true });
  }
  try {
    await client.user.setActivity(null);
  } catch (e) {}
}

async function validateRadioUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', timeout: 5000 });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type');
    return ct && ct.startsWith('audio');
  } catch {
    return false;
  }
}

function getRadioPage(radios, page, currentRadioIndex) {
  const perPage = 24;
  const start = page * perPage;
  const end = Math.min(start + perPage, radios.length);
  const radiosOnPage = radios.slice(start, end);
  const list = radiosOnPage.map((r, i) =>
    `\`${start + i + 1}.\` **${r.name}**${(start + i) === currentRadioIndex ? '  *(jelenleg hallgatott)*' : ''}`
  ).join('\n');
  return { list, radiosOnPage, start, end, hasNext: end < radios.length, hasPrev: page > 0 };
}

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('switch_radio_')) {
      const idx = parseInt(interaction.customId.replace('switch_radio_', ''), 10);
      if (isNaN(idx) || !radios[idx]) {
        await interaction.update({ content: 'Hibás rádió index!', components: [] });
        return;
      }
      await playRadio(idx, interaction);

      // Frissítsd a gombokat, hogy a kijelölt rádió zöld legyen
      const page = Math.floor(idx / 24);
      const { list, radiosOnPage, start, hasNext, hasPrev } = getRadioPage(radios, page, currentRadioIndex);

      const rows = [];
      for (let i = 0; i < radiosOnPage.length; i += 5) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 5 && j < radiosOnPage.length; j++) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`switch_radio_${start + j}`)
              .setLabel(radiosOnPage[j].name)
              .setStyle((start + j) === currentRadioIndex ? ButtonStyle.Success : ButtonStyle.Primary)
          );
        }
        rows.push(row);
      }
      if (hasPrev || hasNext) {
        const navRow = new ActionRowBuilder();
        if (hasPrev) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page - 1}`)
              .setLabel('⬅️ Előző oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        if (hasNext) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page + 1}`)
              .setLabel('➡️ Következő oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(navRow);
      }

      await interaction.update({
        content: `✅ Átváltva erre: **${radios[idx].name}**\n\n🎵 **Elérhető rádióadók (${start + 1}-${start + radiosOnPage.length} / ${radios.length}):**\n${list}\n\nKattints egy gombra a váltáshoz!`,
        components: rows,
        ephemeral: true
      });
      return;
    }
    if (interaction.customId.startsWith('radio_page_')) {
      const page = parseInt(interaction.customId.replace('radio_page_', ''), 10);
      const { list, radiosOnPage, start, hasNext, hasPrev } = getRadioPage(radios, page, currentRadioIndex);

      const rows = [];
      for (let i = 0; i < radiosOnPage.length; i += 5) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 5 && j < radiosOnPage.length; j++) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`switch_radio_${start + j}`)
              .setLabel(radiosOnPage[j].name)
              .setStyle((start + j) === currentRadioIndex ? ButtonStyle.Success : ButtonStyle.Primary)
          );
        }
        rows.push(row);
      }
      if (hasPrev || hasNext) {
        const navRow = new ActionRowBuilder();
        if (hasPrev) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page - 1}`)
              .setLabel('⬅️ Előző oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        if (hasNext) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page + 1}`)
              .setLabel('➡️ Következő oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(navRow);
      }

      await interaction.update({
        content: `🎵 **Elérhető rádióadók (${start + 1}-${start + radiosOnPage.length} / ${radios.length}):**\n${list}\n\nKattints egy gombra a váltáshoz!`,
        components: rows,
        ephemeral: true
      });
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;
  if (name === 'switch') {
    const radioName = interaction.options.getString('name');
    const idx = radios.findIndex(r => r.name.toLowerCase() === radioName.toLowerCase());
    if (idx === -1) {
      await interaction.reply({ content: `❌ Nincs ilyen nevű rádióadó: **${radioName}**`, ephemeral: true });
      return;
    }
    if (!joined) {
      await interaction.reply({ content: 'Előbb csatlakozz a `/join` paranccsal!', ephemeral: true });
      return;
    }
    await playRadio(idx, interaction);
    await interaction.reply({ content: `✅ Átváltva erre: **${radios[idx].name}**`, ephemeral: true });
  }

  if (name === 'join') {
    if (joined) {
      await interaction.reply({ content: 'Már csatlakozva vagyok.', ephemeral: true });
      return;
    }
    await playRadio(currentRadioIndex, interaction);
    await interaction.reply({ content: 'Csatlakoztam a voice csatornához.', ephemeral: true });
  }

  if (name === 'leave') {
    await leaveRadio(interaction);
  }

  if (name === 'add-channel') {
    const radioName = interaction.options.getString('name');
    const link = interaction.options.getString('link');
    if (radios.some(r => r.name.toLowerCase() === radioName.toLowerCase())) {
      await interaction.reply({ content: `❌ Már van ilyen nevű rádióadó: **${radioName}**`, ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const valid = await validateRadioUrl(link);
    if (!valid) {
      await interaction.editReply({ content: '❌ A megadott link nem érvényes vagy nem audio stream.' });
      return;
    }
    radios.push({ name: radioName, url: link });
    saveRadios(radios);
    await interaction.editReply({ content: `✅ Rádióadó hozzáadva: **${radioName}**`, ephemeral: true });
  }

  if (name === 'list-channel') {
    const page = 0;
    if (radios.length === 0) {
      await interaction.reply({ content: 'Nincs elérhető rádióadó.', ephemeral: true });
      return;
    }
    const { list, radiosOnPage, start, hasNext, hasPrev } = getRadioPage(radios, page, currentRadioIndex);

    // Gombok: max 24 rádió, 5 gomb/sor, lapozó gomb(ok) az utolsó sor végére
    const rows = [];
    for (let i = 0; i < radiosOnPage.length; i += 5) {
      const row = new ActionRowBuilder();
      for (let j = i; j < i + 5 && j < radiosOnPage.length; j++) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`switch_radio_${start + j}`)
            .setLabel(radiosOnPage[j].name)
            .setStyle((start + j) === currentRadioIndex ? ButtonStyle.Success : ButtonStyle.Primary)
        );
      }
      rows.push(row);
    }
    if (hasPrev || hasNext) {
      const navRow = new ActionRowBuilder();
      if (hasPrev) {
        navRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`radio_page_${page - 1}`)
            .setLabel('⬅️ Előző oldal')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      if (hasNext) {
        navRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`radio_page_${page + 1}`)
            .setLabel('➡️ Következő oldal')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      rows.push(navRow);
    }

    await interaction.reply({
      content: `🎵 **Elérhető rádióadók (${start + 1}-${start + radiosOnPage.length} / ${radios.length}):**\n${list}\n\nKattints egy gombra a váltáshoz!`,
      components: rows,
      ephemeral: true
    });
  }

  if (name === 'delete-channel') {
    const radioName = interaction.options.getString('name');
    const idx = radios.findIndex(r => r.name.toLowerCase() === radioName.toLowerCase());
    if (idx === -1) {
      await interaction.reply({ content: `❌ Nincs ilyen nevű rádióadó: **${radioName}**`, ephemeral: true });
      return;
    }
    radios.splice(idx, 1);
    saveRadios(radios);
    await interaction.reply({ content: `🗑️ Törölve: **${radioName}**`, ephemeral: true });
    if (currentRadioIndex === idx && joined && radios.length > 0) {
      await playRadio(0);
    }
  }

  if (name === 'info') {
    const radioName = interaction.options.getString('name');
    const radio = radios.find(r => r.name.toLowerCase() === radioName.toLowerCase());
    if (!radio) {
      await interaction.reply({ content: `❌ Nincs ilyen nevű rádióadó: **${radioName}**`, ephemeral: true });
      return;
    }
    await interaction.reply({ content: `ℹ️ **${radio.name}** stream linkje:\n${radio.url}`, ephemeral: true });
  }

  if (name === 'set-channel') {
    const radioName = interaction.options.getString('name');
    const link = interaction.options.getString('link');
    const idx = radios.findIndex(r => r.name.toLowerCase() === radioName.toLowerCase());
    if (idx === -1) {
      await interaction.reply({ content: `❌ Nincs ilyen nevű rádióadó: **${radioName}**`, ephemeral: true });
      return;
    }
    pendingSetChannel[interaction.user.id] = { name: radioName, link };
    await interaction.reply({
      content: `🔄 Biztosan módosítani akarod a(z) **${radioName}** adó linkjét erre?\n${link}\nÍrd be: **yes** vagy **no** (60 mp-en belül)!`,
      ephemeral: true
    });

    // Várj válaszra
    const filter = m => m.author.id === interaction.user.id && ['yes', 'no'].includes(m.content.toLowerCase());
    try {
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
      const answer = collected.first().content.toLowerCase();
      if (answer === 'yes') {
        await interaction.followUp({ content: '⏳ Új link ellenőrzése...', ephemeral: true });
        const valid = await validateRadioUrl(link);
        if (!valid) {
          await interaction.followUp({ content: '❌ A megadott link nem érvényes vagy nem audio stream.', ephemeral: true });
          delete pendingSetChannel[interaction.user.id];
          return;
        }
        radios[idx].url = link;
        saveRadios(radios);
        await interaction.followUp({ content: '✅ Link módosítva!', ephemeral: true });
      } else {
        await interaction.followUp({ content: '❌ Módosítás megszakítva.', ephemeral: true });
      }
    } catch {
      await interaction.followUp({ content: 'Nem érkezett válasz, módosítás megszakítva.', ephemeral: true });
    }
    delete pendingSetChannel[interaction.user.id];
  }

  if (name === 'help') {
    await interaction.reply({
      content:
        `**Elérhető parancsok:**\n` +
        `• \`/switch <név>\` – rádióadó váltása\n` +
        `• \`/join\` – bot csatlakozik a voice csatornához\n` +
        `• \`/leave\` – bot elhagyja a voice csatornát\n` +
        `• \`/add-channel <név> <link>\` – új rádióadó hozzáadása (csak érvényes stream linkkel)\n` +
        `• \`/list-channel\` – elérhető rádióadók nevei\n` +
        `• \`/delete-channel <név>\` – rádióadó törlése\n` +
        `• \`/info <név>\` – rádióadó linkjének lekérdezése\n` +
        `• \`/set-channel <név> <link>\` – rádióadó linkjének módosítása, megerősítéssel\n` +
        `• \`/help\` – parancsok listája és magyarázat\n`,
      ephemeral: true
    });
  }

  // Button interakció kezelése (lapozás és rádióváltás)
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('switch_radio_')) {
      const idx = parseInt(interaction.customId.replace('switch_radio_', ''), 10);
      if (isNaN(idx) || !radios[idx]) {
        await interaction.update({ content: 'Hibás rádió index!', components: [], flags: 64 });
        return;
      }
      await playRadio(idx, interaction);

      // Frissítsd a gombokat, hogy a kijelölt rádió zöld legyen
      const page = Math.floor(idx / 24);
      const { list, radiosOnPage, start, hasNext, hasPrev } = getRadioPage(radios, page, currentRadioIndex);

      const rows = [];
      for (let i = 0; i < radiosOnPage.length; i += 5) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 5 && j < radiosOnPage.length; j++) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`switch_radio_${start + j}`)
              .setLabel(radiosOnPage[j].name)
              .setStyle((start + j) === currentRadioIndex ? ButtonStyle.Success : ButtonStyle.Primary)
          );
        }
        rows.push(row);
      }
      if (hasPrev || hasNext) {
        const navRow = new ActionRowBuilder();
        if (hasPrev) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page - 1}`)
              .setLabel('⬅️ Előző oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        if (hasNext) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page + 1}`)
              .setLabel('➡️ Következő oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(navRow);
      }

      await interaction.update({
        content: `✅ Átváltva erre: **${radios[idx].name}**\n\n🎵 **Elérhető rádióadók (${start + 1}-${start + radiosOnPage.length} / ${radios.length}):**\n${list}\n\nKattints egy gombra a váltáshoz!`,
        components: rows,
        ephemeral: true
      });
      return;
    }
    if (interaction.customId.startsWith('radio_page_')) {
      const page = parseInt(interaction.customId.replace('radio_page_', ''), 10);
      const { list, radiosOnPage, start, hasNext, hasPrev } = getRadioPage(radios, page, currentRadioIndex);

      const rows = [];
      for (let i = 0; i < radiosOnPage.length; i += 5) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 5 && j < radiosOnPage.length; j++) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`switch_radio_${start + j}`)
              .setLabel(radiosOnPage[j].name)
              .setStyle((start + j) === currentRadioIndex ? ButtonStyle.Success : ButtonStyle.Primary)
          );
        }
        rows.push(row);
      }
      if (hasPrev || hasNext) {
        const navRow = new ActionRowBuilder();
        if (hasPrev) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page - 1}`)
              .setLabel('⬅️ Előző oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        if (hasNext) {
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`radio_page_${page + 1}`)
              .setLabel('➡️ Következő oldal')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(navRow);
      }

      await interaction.update({
        content: `🎵 **Elérhető rádióadók (${start + 1}-${start + radiosOnPage.length} / ${radios.length}):**\n${list}\n\nKattints egy gombra a váltáshoz!`,
        components: rows,
        ephemeral: true
      });
      return;
    }
  }
});
