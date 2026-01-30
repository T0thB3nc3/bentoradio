require('dotenv').config();
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { FFmpeg } = require('prism-media');
const ytdl = require('@distube/ytdl-core');

const TOKEN = process.env.TOKEN;
const RADIOS_FILE = './radios.json';
const LAST_RADIO_FILE = './last_radio.json';

// --- ADATKEZELÉS ---
function loadRadios() {
    try { return JSON.parse(fs.readFileSync(RADIOS_FILE, 'utf8')); }
    catch (e) { return [{ name: "alapértelmezett", url: "" }]; }
}
function saveRadios(radios) { fs.writeFileSync(RADIOS_FILE, JSON.stringify(radios, null, 2), 'utf8'); }

function loadLastRadioIndices() {
    try { return JSON.parse(fs.readFileSync(LAST_RADIO_FILE, 'utf8')); }
    catch { return {}; }
}
function saveLastRadioIndex(guildId, index) {
    const indices = loadLastRadioIndices();
    indices[guildId] = index;
    fs.writeFileSync(LAST_RADIO_FILE, JSON.stringify(indices, null, 2), 'utf8');
}

// --- GLOBÁLIS ÁLLAPOTOK ---
let radios = loadRadios();
const guildStates = new Map(); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

function getOrCreateState(guildId) {
    if (!guildStates.has(guildId)) {
        const lastIndices = loadLastRadioIndices();
        guildStates.set(guildId, {
            player: null, connection: null,
            currentRadioIndex: lastIndices[guildId] || 0,
            restarting: false, volume: 0.12, voiceChannelId: null
        });
    }
    return guildStates.get(guildId);
}

// --- SEGÉDFÜGGVÉNYEK ---
async function validateRadioUrl(url) {
    try {
        const res = await fetch(url, { method: 'HEAD', timeout: 5000 });
        const ct = res.headers.get('content-type');
        return res.ok && ct && ct.startsWith('audio');
    } catch { return false; }
}

function getRadioPage(radios, page, currentRadioIndex) {
    const perPage = 24;
    const start = page * perPage;
    const end = Math.min(start + perPage, radios.length);
    const radiosOnPage = radios.slice(start, end);
    const list = radiosOnPage.map((r, i) =>
        `\`${start + i + 1}.\` **${r.name}**${(start + i) === currentRadioIndex ? ' *(szól)*' : ''}`
    ).join('\n');
    return { list, radiosOnPage, start, end, hasNext: end < radios.length, hasPrev: page > 0 };
}

function createRadioButtons(page, guildId) {
    const state = getOrCreateState(guildId);
    const { radiosOnPage, start, hasNext, hasPrev } = getRadioPage(radios, page, state.currentRadioIndex);
    const rows = [];
    for (let i = 0; i < radiosOnPage.length; i += 5) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 5 && j < radiosOnPage.length; j++) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`switch_radio_${start + j}`)
                    .setLabel(radiosOnPage[j].name.substring(0, 80))
                    .setStyle((start + j) === state.currentRadioIndex ? ButtonStyle.Success : ButtonStyle.Primary)
            );
        }
        rows.push(row);
    }
    if (hasPrev || hasNext) {
        const navRow = new ActionRowBuilder();
        if (hasPrev) navRow.addComponents(new ButtonBuilder().setCustomId(`radio_page_${page - 1}`).setLabel('⬅️ Előző').setStyle(ButtonStyle.Secondary));
        if (hasNext) navRow.addComponents(new ButtonBuilder().setCustomId(`radio_page_${page + 1}`).setLabel('➡️ Következő').setStyle(ButtonStyle.Secondary));
        rows.push(navRow);
    }
    return rows;
}

// --- LEJÁTSZÁS ÉS STÁTUSZ ---
async function playRadio(guildId, voiceChannelId, index = null, interaction = null) {
    const state = getOrCreateState(guildId);
    if (index !== null) { state.currentRadioIndex = index; saveLastRadioIndex(guildId, index); }

    const radio = radios[state.currentRadioIndex];
    if (!radio) return;

    try {
        const channel = await client.channels.fetch(voiceChannelId, { force: true });
        state.voiceChannelId = voiceChannelId;
        
        // --- STÁTUSZ BEÁLLÍTÁSA ---
        if (channel.isVoiceBased()) {
            try {
                await channel.setStatus(`🎵 Szól: ${radio.name}`);
                console.log(`✅ Státusz beállítva: [${channel.guild.name}]`);
            } catch (e) { console.log(`❌ Joghiba (SetStatus): [${channel.guild.name}]`); }
        }

        // --- CSATLAKOZÁS ---
        state.connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guildId,
            adapterCreator: channel.guild.voiceAdapterCreator
        });

        if (state.player) state.player.stop();
        state.player = createAudioPlayer();
        
        let resource;
        const inputUrl = radio.url;

        if (inputUrl.includes('youtube.com') || inputUrl.includes('youtu.be')) {
            const stream = ytdl(inputUrl, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
            resource = createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        } else {
            const transcoder = new FFmpeg({
                args: [
                    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
                    '-i', inputUrl,
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                    '-loglevel', '8',
                ],
            });

            transcoder.on('error', error => {
                console.error(`❌ FFmpeg hiba [${radio.name}]: ${error.message}`);
            });

            resource = createAudioResource(transcoder, {
                inputType: StreamType.Raw,
                inlineVolume: true
            });
        }

        resource.volume.setVolume(state.volume);
        state.player.play(resource);
        state.connection.subscribe(state.player);

        // --- ESEMÉNYEK ---
        state.player.on('stateChange', (oldS, newS) => {
            console.log(`[${radio.name}] Állapot: ${oldS.status} -> ${newS.status}`);
        });

        state.player.on('error', error => {
            console.error(`❌ Player hiba: ${error.message}`);
        });

        state.player.on(AudioPlayerStatus.Idle, () => {
            if (!state.restarting) {
                state.restarting = true;
                setTimeout(() => { state.restarting = false; playRadio(guildId, voiceChannelId); }, 2000);
            }
        });

    } catch (e) { console.error("Hiba történt a lejátszás indításakor:", e); }
}

// --- PARANCSOK REGISZTRÁLÁSA ---
const commands = [
    new SlashCommandBuilder().setName('play').setDescription('YouTube link lejátszása').addStringOption(o => o.setName('url').setDescription('YouTube link').setRequired(true)),
    new SlashCommandBuilder().setName('switch').setDescription('Rádióadó váltása név alapján').addStringOption(o => o.setName('name').setDescription('Adó neve').setRequired(true)),
    new SlashCommandBuilder().setName('join').setDescription('Csatlakozás a csatornádhoz'),
    new SlashCommandBuilder().setName('leave').setDescription('Bot kiléptetése'),
    new SlashCommandBuilder().setName('add-channel').setDescription('Új adó (Admin)').addStringOption(o => o.setName('name').setRequired(true).setDescription('Név')).addStringOption(o => o.setName('link').setRequired(true).setDescription('Stream link')).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder().setName('list-channel').setDescription('Adók listázása'),
    new SlashCommandBuilder().setName('delete-channel').setDescription('Törlés (Admin)').addStringOption(o => o.setName('name').setRequired(true).setDescription('Név')).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder().setName('info').setDescription('Link lekérése').addStringOption(o => o.setName('name').setRequired(true).setDescription('Név')),
    new SlashCommandBuilder().setName('set-channel').setDescription('Módosítás (Admin)').addStringOption(o => o.setName('name').setRequired(true).setDescription('Név')).addStringOption(o => o.setName('link').setRequired(true).setDescription('Új link')).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder().setName('help').setDescription('Segítség')
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`${client.user.tag} üzemkész!`);
});

// --- INTERAKCIÓK ---
client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;
    const guildId = interaction.guildId;
    const state = getOrCreateState(guildId);

    if (interaction.isButton()) {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: 'Lépj be egy voice-ba!', flags: [MessageFlags.Ephemeral] });
        
        if (interaction.customId.startsWith('switch_radio_')) {
            const idx = parseInt(interaction.customId.split('_')[2]);
            await playRadio(guildId, voiceChannel.id, idx, interaction);
            const { list } = getRadioPage(radios, Math.floor(idx / 24), idx);
            await interaction.update({ 
                content: `✅ Átváltva: **${radios[idx].name}**\n${list}`, 
                components: createRadioButtons(Math.floor(idx / 24), guildId) 
            });
        }
        if (interaction.customId.startsWith('radio_page_')) {
            const page = parseInt(interaction.customId.split('_')[2]);
            const { list } = getRadioPage(radios, page, state.currentRadioIndex);
            await interaction.update({ 
                content: `🎵 Adók listája:\n${list}`, 
                components: createRadioButtons(page, guildId) 
            });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    if (commandName === 'play') {
        const url = options.getString('url');
        radios.push({ name: 'YouTube ideiglenes', url });
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: 'Nem vagy voice-ban!', flags: [MessageFlags.Ephemeral] });
        await playRadio(guildId, voiceChannel.id, radios.length - 1, interaction);
        await interaction.reply({ content: `▶️ Lejátszás indítva: ${url}`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'join' || commandName === 'switch') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: 'Nem vagy voice-ban!', flags: [MessageFlags.Ephemeral] });
        let idx = state.currentRadioIndex;
        if (commandName === 'switch') {
            const name = options.getString('name');
            idx = radios.findIndex(r => r.name.toLowerCase() === name.toLowerCase());
            if (idx === -1) return interaction.reply({ content: 'Nincs ilyen adó a listában.', flags: [MessageFlags.Ephemeral] });
        }
        await playRadio(guildId, voiceChannel.id, idx, interaction);
        await interaction.reply({ content: `🎵 Mostantól szól a **${radios[idx].name}**`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'leave') {
        if (state.connection) {
            try {
                const channel = await client.channels.fetch(state.voiceChannelId);
                await channel.setStatus(null);
            } catch (e) {}
            state.connection.destroy();
            state.connection = null;
            await interaction.reply('Kiléptem a csatornából.');
        } else await interaction.reply({ content: 'Nem vagyok hangcsatornában.', flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'list-channel') {
        const { list } = getRadioPage(radios, 0, state.currentRadioIndex);
        await interaction.reply({ 
            content: `🎵 Elérhető adók listája:\n${list}`, 
            components: createRadioButtons(0, guildId), 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    if (commandName === 'help') {
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
            flags: [MessageFlags.Ephemeral] 
        });
    }
});

client.login(TOKEN);