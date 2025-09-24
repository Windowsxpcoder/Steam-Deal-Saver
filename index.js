function removeDealsChannelId(guildId) {
    // Unified store: clear dealsChannelId in the guild databank
    try {
        setGuildConfig(guildId, { dealsChannelId: null });
    } catch { }
}
// Notify owner when bot is removed from a server
// Rate limiting (per user per command)
const rateLimits = {};
function isRateLimited(userId, command, limitMs = 5000) {
    const now = Date.now();
    if (!rateLimits[userId]) rateLimits[userId] = {};
    if (!rateLimits[userId][command] || now - rateLimits[userId][command] > limitMs) {
        rateLimits[userId][command] = now;
        return false;
    }
    return true;
}
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import QuickChart from 'quickchart-js';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// Unified per-guild databank (channels, currency, etc.)
const GUILDS_DATABANK_PATH = './guilds_databank.json';
// Update log opt-in store
const UPDATE_OPTIN_PATH = './update_optin_guilds.json';

// Helpers for update log opt-in persistence
function readUpdateOptIn() {
    try {
        if (!fs.existsSync(UPDATE_OPTIN_PATH)) {
            fs.writeFileSync(UPDATE_OPTIN_PATH, JSON.stringify({ guilds: [] }, null, 2));
            return { guilds: [] };
        }
        const data = JSON.parse(fs.readFileSync(UPDATE_OPTIN_PATH, 'utf8'));
        if (data && Array.isArray(data.guilds)) return data;
    } catch { }
    return { guilds: [] };
}
function writeUpdateOptIn(data) {
    try {
        fs.writeFileSync(UPDATE_OPTIN_PATH, JSON.stringify({ guilds: Array.from(new Set(data.guilds || [])) }, null, 2));
    } catch { }
}
function isGuildOptedInForUpdates(guildId) {
    const data = readUpdateOptIn();
    return data.guilds.includes(guildId);
}
function setGuildOptInForUpdates(guildId, optIn) {
    const data = readUpdateOptIn();
    const set = new Set(data.guilds || []);
    if (optIn) set.add(guildId); else set.delete(guildId);
    writeUpdateOptIn({ guilds: Array.from(set) });
}

function addDealsChannelId(guildId, channelId) {
    // Unified store: set dealsChannelId in the guild databank
    try {
        setGuildConfig(guildId, { dealsChannelId: channelId });
    } catch { }
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
let CLIENT_ID;
let GUILD_IDS = [];
const CONFIG_PATH = './config.json'; // legacy path (migration support)

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });
// Temporary storage for pending deals channel setup per guild
// Map<guildId, { channelId: string, userId: string, timeout: NodeJS.Timeout, messageId?: string }>
const pendingChannelSetup = new Map();
// Notify owner when bot is removed from a server
client.on('guildDelete', async (guild) => {
    try {
        const ownerId = '1073250313726857337';
        const user = await client.users.fetch(ownerId);
        const totalGuilds = client.guilds.cache.size;
        // Purge all data related to this guild
        try {
            await deleteGuildData(guild.id);
        } catch (purgeErr) {
            console.error('Error purging guild data on removal:', purgeErr);
        }
        try {
            // Remove from update log opt-in list
            setGuildOptInForUpdates(guild.id, false);
        } catch { }
        await user.send({
            embeds: [{
                color: 0xff4d4f,
                title: '🔻 Bot Removed from Server',
                description: `**${guild.name}** (ID: ${guild.id})`,
                fields: [
                    { name: 'Total Servers', value: totalGuilds.toString(), inline: true }
                ],
                thumbnail: guild.iconURL ? { url: guild.iconURL() } : undefined,
                timestamp: new Date().toISOString(),
                footer: { text: 'Steam Deal Saver • Status' }
            }]
        });
    } catch (error) {
        console.error('Error sending DM on guild removal:', error);
    }
});
// Refresh slash commands when joining a new server

// Helper: perform broadcast to all guilds
async function performBroadcast(client, type, rawContent) {
    // Treat '&' as an explicit line break marker and remove the symbol
    const content = typeof rawContent === 'string' ? rawContent.split('&').map(s => s.trimEnd()).join('\n') : rawContent;
    let msg = '';
    if (type === 'message') {
        msg = content;
    } else if (type === 'updatelog') {
        msg = {
            embeds: [{
                color: 0x3498db,
                title: '📢 Update Log',
                description: content,
                timestamp: new Date().toISOString(),
                footer: { text: 'Steam Deal Saver Bot' }
            }]
        };
    } else {
        throw new Error('Invalid broadcast type');
    }
    let sentCount = 0, failedCount = 0;
    for (const guild of client.guilds.cache.values()) {
        // Respect opt-in for update logs
        if (type === 'updatelog' && !isGuildOptedInForUpdates(guild.id)) {
            continue;
        }
        let channel = null;
        // Try deals channel first from unified store
        const cfg = getGuildConfig(guild.id);
        if (cfg.dealsChannelId) {
            try {
                channel = await client.channels.fetch(cfg.dealsChannelId);
            } catch { }
        }
        // Fallback: try to find a 'global' or 'general' text channel
        if (!channel) {
            channel = guild.channels.cache.find(c =>
                c.type === 0 && (c.name.toLowerCase().includes('global') || c.name.toLowerCase().includes('general'))
            );
        }
        // Fallback: use system channel
        if (!channel && guild.systemChannel) {
            channel = guild.systemChannel;
        }
        // Send if found
        if (channel) {
            try {
                await channel.send(msg);
                sentCount++;
            } catch {
                failedCount++;
            }
        } else {
            failedCount++;
        }
    }
    return { sentCount, failedCount };
}

// Helper: get member counts separated into humans and bots (best effort)
async function getMemberBreakdown(guild) {
    try {
        // Fetch full member list; requires Server Members Intent enabled for the bot
        await guild.members.fetch();
        const total = guild.members.cache.size;
        const bots = guild.members.cache.filter(m => m.user?.bot).size;
        const humans = total - bots;
        return { humans, bots };
    } catch {
        // Fallback when intent is disabled or fetch fails
        return { humans: null, bots: null };
    }
}

client.on('guildCreate', async (guild) => {
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: commands }
        );
        console.log(`Slash commands registered for new guild: ${guild.id}`);
        // Send DM to bot owner when joining a new server
        const ownerId = '1073250313726857337';
        const user = await client.users.fetch(ownerId);
        const totalGuilds = client.guilds.cache.size;
        // Collect server info
        const textCount = guild.channels.cache.filter(c => c.type === 0 || c.type === 5 || c.type === 15).size;
        const voiceCount = guild.channels.cache.filter(c => c.type === 2).size;
        const totalChannels = guild.channels.cache.size;
        const createdAt = guild.createdAt;
        const ageDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)) : null;
        const boostLevelMap = { 0: 'None', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3' };
        const boostLevel = boostLevelMap[guild.premiumTier || 0] || 'None';
        const boosters = (guild.premiumSubscriptionCount ?? 0).toString();
        const ownerMention = guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown';
        const locale = guild.preferredLocale || 'default';
        const features = Array.isArray(guild.features) && guild.features.length
            ? guild.features.slice(0, 6).map(f => f.toLowerCase().replace(/_/g, ' ')).join(', ')
            : 'None';
        const mb = await getMemberBreakdown(guild);
        await user.send({
            embeds: [{
                color: 0x52c41a,
                title: '🟢 Bot Joined New Server',
                description: `**${guild.name}** (ID: ${guild.id})`,
                fields: [
                    { name: 'Total Servers', value: totalGuilds.toString(), inline: true },
                    { name: 'Members', value: `${(guild.memberCount ?? 'Unknown')} total${mb.humans !== null ? `\n${mb.humans} humans • ${mb.bots} bots` : ''}`, inline: true },
                    { name: 'Channels', value: `${totalChannels} total\n${textCount} text • ${voiceCount} voice`, inline: true },
                    { name: 'Owner', value: ownerMention, inline: true },
                    { name: 'Created', value: createdAt ? `${createdAt.toLocaleDateString()} (${ageDays}d ago)` : 'Unknown', inline: true },
                    { name: 'Boosts', value: `${boostLevel} • ${boosters} boosters`, inline: true },
                    { name: 'Locale', value: locale, inline: true },
                    { name: 'Features', value: features, inline: false }
                ],
                thumbnail: guild.iconURL ? { url: guild.iconURL() } : undefined,
                timestamp: new Date().toISOString(),
                footer: { text: 'Steam Deal Saver • Status' }
            }]
        });
        // Send welcome message and update log opt-in prompt in a suitable channel
        let targetChannel = null;
        if (guild.systemChannel) targetChannel = guild.systemChannel;
        if (!targetChannel) {
            targetChannel = guild.channels.cache.find(c => c.type === 0 && (c.name.toLowerCase().includes('general') || c.name.toLowerCase().includes('global')));
        }
        if (!targetChannel) {
            targetChannel = guild.channels.cache.find(c => c.type === 0);
        }
        if (targetChannel) {
            // Welcome message
            targetChannel.send({
                embeds: [{
                    color: 0x3498db,
                    title: '👋 Thanks for adding Steam Deal Saver!',
                    description: 'I will help you track Steam deals, price history, and more!\n\n• Use `/setdealschannel` to set the auto-post channel and currency\n• Try `/steamdeals` and `/help` to see all of the commands! \n\nNeed help? Join our support server: https://discord.gg/JGXMbFFVYj',
                    footer: { text: 'Steam Deal Saver • Welcome' }
                }]
            }).catch(() => { });
            // Opt-in prompt
            const yesBtn = new ButtonBuilder().setCustomId('update_optin_yes').setLabel('Yes').setStyle(ButtonStyle.Success);
            const noBtn = new ButtonBuilder().setCustomId('update_optin_no').setLabel('No').setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(yesBtn, noBtn);
            targetChannel.send({
                embeds: [{
                    color: 0x5865F2,
                    title: 'Want to stay up to date?',
                    description: 'Would you like to receive the bot\'s update logs in this server? You can change this later by pressing the buttons again.',
                    footer: { text: 'Steam Deal Saver • Updates' }
                }],
                components: [row]
            }).catch(() => { });
        }
    } catch (error) {
        console.error('Error registering commands for new guild or sending DM:', error);
    }
});

// Register slash commands for all guilds after login
const commands = [
    new SlashCommandBuilder().setName('steamdeals').setDescription('Show Steam games with 20%+ off'),
    new SlashCommandBuilder()
        .setName('setcurrency')
        .setDescription('Change the server currency for prices')
        .addStringOption(option =>
            option.setName('currency')
                .setDescription('Choose the currency to use in this server')
                .setRequired(true)
                .addChoices(
                    { name: 'Euro (EUR €)', value: 'EUR' },
                    { name: 'US Dollar (USD $)', value: 'USD' },
                    { name: 'British Pound (GBP £)', value: 'GBP' },
                    { name: 'Polish Złoty (PLN zł)', value: 'PLN' },
                    { name: 'Canadian Dollar (CAD $)', value: 'CAD' },
                    { name: 'Australian Dollar (AUD $)', value: 'AUD' },
                    { name: 'Japanese Yen (JPY ¥)', value: 'JPY' }
                )
        ),
    new SlashCommandBuilder()
        .setName('setdealschannel')
        .setDescription('Set a channel for automatic Steam deals posting')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Select the channel to post deals in')
                .setRequired(true)
        ),
    new SlashCommandBuilder().setName('gaben').setDescription('Sends a Gaben deals meme'),
    new SlashCommandBuilder().setName('info').setDescription('Show bot info'),
    new SlashCommandBuilder()
        .setName('gameinfo')
        .setDescription('Show stats for a Steam game')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name of the Steam game')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('gamepricehistory')
        .setDescription('Show price history for a Steam game')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name of the Steam game')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show this help message'),
    new SlashCommandBuilder()
        .setName('freshgames')
        .setDescription('Show new Steam games released in the last 30 days (no repeats)'),
    new SlashCommandBuilder()
        .setName('removesetchannel')
        .setDescription('Remove the auto-posting Steam deals channel'),
    new SlashCommandBuilder()
        .setName('dealalerts')
        .setDescription('Subscribe for DM alerts when a specific game goes on sale')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name of the Steam game')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('unsubscribealert')
        .setDescription('Unsubscribe from DM deal alerts for a specific game')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name of the Steam game')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('testalert')
        .setDescription('Send a test DM alert to yourself to verify alert delivery'),
    new SlashCommandBuilder()
        .setName('listalerts')
        .setDescription('List all games you are subscribed to for deal alerts'),
    new SlashCommandBuilder()
        .setName('clearalerts')
        .setDescription('Clear all your deal alert subscriptions'),
    new SlashCommandBuilder()
        .setName('broadcast')
        .setDescription('Owner-only')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of broadcast: message or updatelog')
                .setRequired(true)
                .addChoices(
                    { name: 'message', value: 'message' },
                    { name: 'updatelog', value: 'updatelog' }
                )
        )
        .addStringOption(option =>
            option.setName('content')
                .setDescription('The message or update log to broadcast')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('broadcastfile')
        .setDescription('Owner-only'),
].map(cmd => cmd.toJSON());

// Deal alert subscription storage
const ALERTS_PATH = './deal_alerts.json';
function getAlerts(guildId) {
    let allAlerts = [];
    try {
        allAlerts = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
    } catch {
        allAlerts = [];
    }
    if (!guildId) return allAlerts;
    return allAlerts.filter(a => a.guildId === guildId);
}
function setAlerts(guildId, alerts) {
    let allAlerts = [];
    try {
        allAlerts = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
    } catch {
        allAlerts = [];
    }
    // Remove old alerts for this guild
    allAlerts = allAlerts.filter(a => a.guildId !== guildId);
    // Add new alerts for this guild
    if (Array.isArray(alerts)) {
        alerts.forEach(a => {
            allAlerts.push({ ...a, guildId });
        });
    }
    fs.writeFileSync(ALERTS_PATH, JSON.stringify(allAlerts, null, 2));
}

// Helper to update lastActive for a user
function updateUserLastActive(userId) {
    let alerts = getAlerts();
    const now = Date.now();
    let updated = false;
    alerts = alerts.map(a => {
        if (a.userId === userId) {
            if (!a.lastActive || a.lastActive < now) {
                a.lastActive = now;
                updated = true;
            }
        }
        return a;
    });
    if (updated) setAlerts(alerts);
}
client.on('interactionCreate', async interaction => {
    // Handle currency selection for pending setdealschannel
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
        if (interaction.customId === 'currency_select') {
            const pending = pendingChannelSetup.get(interaction.guildId);
            if (!pending) {
                await interaction.reply({ content: 'No pending setup found. Please run /setdealschannel again.', ephemeral: true });
                return;
            }
            if (interaction.user.id !== pending.userId) {
                await interaction.reply({ content: 'Only the admin who initiated the setup can select the currency.', ephemeral: true });
                return;
            }
            const currency = interaction.values?.[0] || 'EUR';
            setGuildConfig(interaction.guildId, { dealsChannelId: pending.channelId, currency });
            addDealsChannelId(interaction.guildId, pending.channelId);
            // Clear timeout and pending state
            if (pending.timeout) clearTimeout(pending.timeout);
            pendingChannelSetup.delete(interaction.guildId);
            await interaction.update({
                embeds: [{
                    color: 0x2ecc71,
                    title: 'Deals Channel Set',
                    description: `Channel <#${pending.channelId}> is now set for automatic Steam deals posting.\nCurrency: **${currency}**`,
                }],
                components: []
            });
        }
        return;
    }
    // Handle reopen currency selection button
    if (interaction.isButton && interaction.isButton()) {
        if (interaction.customId === 'currency_reopen') {
            const pending = pendingChannelSetup.get(interaction.guildId);
            if (!pending) {
                await interaction.reply({ content: 'No pending setup found. Please run /setdealschannel again.', ephemeral: true });
                return;
            }
            if (interaction.user.id !== pending.userId) {
                await interaction.reply({ content: 'Only the admin who initiated the setup can change the currency.', ephemeral: true });
                return;
            }
            const select = new StringSelectMenuBuilder()
                .setCustomId('currency_select')
                .setPlaceholder('Choose your currency')
                .addOptions(
                    { label: 'Euro (EUR €)', value: 'EUR' },
                    { label: 'US Dollar (USD $)', value: 'USD' },
                    { label: 'British Pound (GBP £)', value: 'GBP' },
                    { label: 'Polish Złoty (PLN zł)', value: 'PLN' },
                    { label: 'Canadian Dollar (CAD $)', value: 'CAD' },
                    { label: 'Australian Dollar (AUD $)', value: 'AUD' },
                    { label: 'Japanese Yen (JPY ¥)', value: 'JPY' }
                );
            const row = new ActionRowBuilder().addComponents(select);
            const reopenBtn = new ButtonBuilder()
                .setCustomId('currency_reopen')
                .setLabel('Change Currency')
                .setStyle(ButtonStyle.Secondary);
            const btnRow = new ActionRowBuilder().addComponents(reopenBtn);
            await interaction.update({ components: [row, btnRow] });
        } else if (interaction.customId === 'update_optin_yes' || interaction.customId === 'update_optin_no') {
            // Only allow server admins to set the update log preference
            const isAdmin = interaction.member?.permissions?.has && interaction.member.permissions.has('Administrator');
            if (!isAdmin) {
                await interaction.reply({ content: 'Only server admins can choose this.', ephemeral: true });
                return;
            }
            const optIn = interaction.customId === 'update_optin_yes';
            setGuildOptInForUpdates(interaction.guildId, optIn);
            // Disable buttons on the prompt message
            const yesBtn = new ButtonBuilder().setCustomId('update_optin_yes').setLabel('Yes').setStyle(ButtonStyle.Success).setDisabled(true);
            const noBtn = new ButtonBuilder().setCustomId('update_optin_no').setLabel('No').setStyle(ButtonStyle.Danger).setDisabled(true);
            const row = new ActionRowBuilder().addComponents(yesBtn, noBtn);
            await interaction.update({ components: [row] }).catch(() => { });
            if (optIn) {
                // Try to send the current update log to this channel immediately
                const path = './update_log.txt';
                if (!fs.existsSync(path)) {
                    await interaction.followUp({ content: 'Opt-in saved. No update_log.txt found to post right now.', ephemeral: true }).catch(() => { });
                } else {
                    try {
                        let content = fs.readFileSync(path, 'utf8') || '';
                        // Normalize newlines
                        content = content.replace(/\r?\n/g, '\n');
                        if (content.length > 3900) content = content.slice(0, 3900) + '\n... (truncated)';
                        const msg = {
                            embeds: [{
                                color: 0x3498db,
                                title: '📢 Update Log',
                                description: content,
                                timestamp: new Date().toISOString(),
                                footer: { text: 'Steam Deal Saver Bot' }
                            }]
                        };
                        await interaction.channel.send(msg).catch(() => { });
                        await interaction.followUp({ content: 'Opt-in saved. Posted the latest update log in this channel.', ephemeral: true }).catch(() => { });
                    } catch {
                        await interaction.followUp({ content: 'Opt-in saved, but failed to read or post the update log.', ephemeral: true }).catch(() => { });
                    }
                }
            } else {
                await interaction.followUp({ content: 'Opt-out saved. I will not post update logs in this server.', ephemeral: true }).catch(() => { });
            }
        }
        return;
    }
    // Broadcast command (owner only, with type option)
    if (interaction.commandName === 'broadcast') {
        const ownerId = '1073250313726857337';
        if (interaction.user.id !== ownerId) {
            await interaction.reply({ content: 'Only the bot owner can use this command.', ephemeral: true });
            return;
        }
        const type = interaction.options.getString('type');
        const rawContent = interaction.options.getString('content');
        if (type !== 'message' && type !== 'updatelog') {
            await interaction.reply({ content: 'Invalid type. Use "message" or "updatelog".', ephemeral: true });
            return;
        }
        await interaction.reply({ content: `Broadcasting message to ${client.guilds.cache.size} servers...`, ephemeral: true });
        const { sentCount, failedCount } = await performBroadcast(client, type, rawContent);
        await interaction.followUp({ content: `Broadcast complete. Sent: ${sentCount}, Failed: ${failedCount}`, ephemeral: true });
        return;
    }
    // Broadcast update log from update_log.txt (owner only)
    if (interaction.commandName === 'broadcastfile') {
        const ownerId = '1073250313726857337';
        if (interaction.user.id !== ownerId) {
            await interaction.reply({ content: 'Only the bot owner can use this command.', ephemeral: true });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            const path = './update_log.txt';
            if (!fs.existsSync(path)) {
                await interaction.editReply({ content: 'update_log.txt not found in the bot directory.' });
                return;
            }
            let content = fs.readFileSync(path, 'utf8');
            // Convert actual newlines to '&' markers so the standard broadcast parser renders them as new lines
            content = content.replace(/\r?\n/g, ' & ');
            // Protect against overly long embeds (Discord limit ~4096 chars for embed description)
            if (content.length > 3900) {
                content = content.slice(0, 3900) + ' & ... (truncated)';
            }
            const { sentCount, failedCount } = await performBroadcast(client, 'updatelog', content);
            await interaction.editReply({ content: `Update log broadcast complete to opted-in servers. Sent: ${sentCount}, Failed: ${failedCount}` });
        } catch (e) {
            console.error('broadcastfile error:', e);
            await interaction.editReply({ content: 'Failed to read or broadcast update_log.txt.' });
        }
        return;
    }
    // ... (makelog command removed per user request)
    // Log command usage with guild info
    if (interaction.guild) {
        console.log(`[COMMAND] ${interaction.commandName} used in guild: ${interaction.guild.name} (ID: ${interaction.guildId})`);
    } else {
        console.log(`[COMMAND] ${interaction.commandName} used outside of a guild.`);
    }
    // Rate limit all commands except 'help'
    if (interaction.commandName !== 'help' && isRateLimited(interaction.user.id, interaction.commandName, 5000)) {
        await interaction.reply({ content: 'You are doing that too fast. Please wait a few seconds.', ephemeral: true });
        return;
    }
    // Restrict only /setdealschannel and /removesetchannel to admins
    if ((interaction.commandName === 'setdealschannel' || interaction.commandName === 'removesetchannel' || interaction.commandName === 'setcurrency') && !interaction.member.permissions.has('Administrator')) {
        await interaction.reply({ content: 'Only server admins can use this command.', ephemeral: true });
        return;
    }
    if (interaction.commandName === 'clearalerts') {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;
        let alerts = getAlerts(interaction.guildId);
        const before = alerts.length;
        alerts = alerts.filter(a => a.userId !== userId);
        setAlerts(interaction.guildId, alerts);
        if (alerts.length < before) {
            await interaction.editReply('All your deal alert subscriptions have been cleared.');
        } else {
            await interaction.editReply('You had no active deal alert subscriptions.');
        }
        return;
    }
    // Update lastActive for any command
    updateUserLastActive(interaction.user.id);
    if (interaction.commandName === 'listalerts') {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;
        const alerts = getAlerts(interaction.guildId).filter(a => a.userId === userId);
        if (alerts.length === 0) {
            await interaction.editReply('You are not subscribed to any game alerts.');
        } else {
            const gameList = alerts.map(a => `• ${a.gameName}`).join('\n');
            await interaction.editReply(`You are subscribed to alerts for:\n${gameList}`);
        }
        return;
    }
    if (interaction.commandName === 'testalert') {
        await interaction.deferReply({ ephemeral: true });
        try {
            await interaction.user.send('✅ This is a test DM alert from SteamDealSaver. If you see this, alerts are working!');
            await interaction.editReply('Test alert sent! Check your DMs.');
        } catch {
            await interaction.editReply('Failed to send DM. Please make sure your DMs are open.');
        }
        return;
    }
    if (interaction.commandName === 'unsubscribealert') {
        await interaction.deferReply({ ephemeral: true });
        const gameName = interaction.options.getString('name');
        const userId = interaction.user.id;
        let alerts = getAlerts(interaction.guildId);
        const before = alerts.length;
        alerts = alerts.filter(a => !(a.userId === userId && a.gameName.toLowerCase() === gameName.toLowerCase()));
        setAlerts(interaction.guildId, alerts);
        if (alerts.length < before) {
            await interaction.editReply(`You have unsubscribed from alerts for "${gameName}".`);
        } else {
            await interaction.editReply(`You were not subscribed for alerts on "${gameName}".`);
        }
        return;
    }
    if (interaction.commandName === 'dealalerts') {
        await interaction.deferReply({ ephemeral: true });
        const gameName = interaction.options.getString('name');
        const userId = interaction.user.id;
        let alerts = getAlerts(interaction.guildId);
        // Prevent duplicate subscriptions
        if (alerts.some(a => a.userId === userId && a.gameName.toLowerCase() === gameName.toLowerCase())) {
            await interaction.editReply('You are already subscribed for alerts on this game.');
            return;
        }
        alerts.push({ userId, gameName, lastActive: Date.now() });
        setAlerts(interaction.guildId, alerts);
        await interaction.editReply(`You will receive a DM when "${gameName}" goes on sale!`);
        return;
    }
    if (interaction.commandName === 'removesetchannel') {
        await interaction.deferReply();
        const config = getGuildConfig(interaction.guildId);
        if (!config.dealsChannelId) {
            await interaction.editReply('No auto-posting channel is currently set.');
            return;
        }
        setGuildConfig(interaction.guildId, { dealsChannelId: null });
        // Remove from deals_channels.json as well
        removeDealsChannelId(interaction.guildId);
        await interaction.editReply('Auto-posting Steam deals channel has been removed.');
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'setcurrency') {
        await interaction.deferReply({ ephemeral: true });
        const currency = interaction.options.getString('currency');
        if (!CURRENCY_SETTINGS[currency]) {
            await interaction.editReply('Invalid currency.');
            return;
        }
        setGuildConfig(interaction.guildId, { currency });
        await interaction.editReply(`Currency updated to **${currency}** for this server.`);
        return;
    }
    if (interaction.commandName === 'gamepricehistory') {
        await interaction.deferReply();
        const gameName = interaction.options.getString('name');
        try {
            // Try ITAD first
            const itadKey = 'c99a476eb2adc67979186c9b0be287e53deb4c19';
            let searchRes;
            let game = null;
            let appId = null;
            try {
                searchRes = await axios.get(`https://api.isthereanydeal.com/v02/search/search/?key=${itadKey}&q=${encodeURIComponent(gameName)}&limit=1`);
                const searchResults = searchRes.data.data?.results;
                if (searchResults && searchResults.length > 0) {
                    game = searchResults[0];
                }
            } catch (searchErr) {
                // Ignore ITAD errors for fallback
            }
            let plain = game?.plain;
            let chartUrl = null;
            let embed = null;
            if (plain) {
                try {
                    const historyRes = await axios.get(`https://api.isthereanydeal.com/v01/game/price/history/?key=${itadKey}&plains=${plain}&region=eu`);
                    const history = historyRes.data.data[plain]?.list;
                    if (history && history.length > 0) {
                        const labels = history.map(h => new Date(h.date * 1000).toLocaleDateString());
                        const prices = history.map(h => h.price);
                        const chart = new QuickChart();
                        chart.setConfig({
                            type: 'line',
                            data: {
                                labels: labels,
                                datasets: [{
                                    label: 'Price (€)',
                                    data: prices,
                                    fill: false,
                                    borderColor: 'rgb(75, 192, 192)',
                                    tension: 0.1
                                }]
                            },
                            options: {
                                title: {
                                    display: true,
                                    text: `${game.title} Price History`
                                },
                                scales: {
                                    y: {
                                        beginAtZero: false
                                    }
                                }
                            }
                        });
                        chart.setWidth(700).setHeight(400).setBackgroundColor('white');
                        chartUrl = chart.getUrl();
                        embed = {
                            color: 0x3498db,
                            title: `${game.title} Price History`,
                            url: `https://isthereanydeal.com/game/${plain}/history/`,
                            description: `Historical price data for **${game.title}** (Steam). Source: IsThereAnyDeal`,
                            image: { url: chartUrl },
                            footer: { text: 'Powered by IsThereAnyDeal & QuickChart' }
                        };
                        return await interaction.editReply({ embeds: [embed] });
                    }
                } catch (err) {
                    // Ignore ITAD errors for fallback
                }
            }
            // Fallback: search Steam API for appId and send SteamDB link
            try {
                const steamRes = await axios.get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&cc=us`);
                const steamResults = steamRes.data.items;
                if (steamResults && steamResults.length > 0) {
                    appId = steamResults[0].id;
                    const steamdbUrl = `https://steamdb.info/app/${appId}/price/`;
                    embed = {
                        color: 0x3498db,
                        title: `${steamResults[0].name} Price History (SteamDB)`,
                        url: steamdbUrl,
                        description: `Price history for **${steamResults[0].name}** is available on [SteamDB](${steamdbUrl}).`,
                        footer: { text: 'Source: SteamDB' }
                    };
                    return await interaction.editReply({ embeds: [embed] });
                } else {
                    return await interaction.editReply(`No results found for "${gameName}". Please check the spelling or try a different title.`);
                }
            } catch (err) {
                console.error('Error in /gamegraph fallback:', err);
                return await interaction.editReply('Error fetching price history graph.');
            }
        } catch (err) {
            console.error('Error in /gamegraph:', err);
            return await interaction.editReply('Error fetching price history graph.');
        }
    }
    if (interaction.commandName === 'steamdeals') {
        await interaction.deferReply();
        try {
            const cfg = getGuildConfig(interaction.guildId);
            const currency = cfg.currency || 'EUR';
            const dealsEmbed = await getCachedSteamDealsEmbed(currency);
            await interaction.editReply(dealsEmbed);
        } catch (err) {
            await interaction.editReply('Error fetching Steam deals.');
        }
    }
    if (interaction.commandName === 'setdealschannel') {
        await interaction.deferReply({ ephemeral: true });
        const channel = interaction.options.getChannel('channel');
        if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
            await interaction.editReply('Please select a valid text channel.');
            return;
        }
        // Prepare UI components
        const select = new StringSelectMenuBuilder()
            .setCustomId('currency_select')
            .setPlaceholder('Choose your currency')
            .addOptions(
                { label: 'Euro (EUR €)', value: 'EUR' },
                { label: 'US Dollar (USD $)', value: 'USD' },
                { label: 'British Pound (GBP £)', value: 'GBP' },
                { label: 'Polish Złoty (PLN zł)', value: 'PLN' },
                { label: 'Canadian Dollar (CAD $)', value: 'CAD' },
                { label: 'Australian Dollar (AUD $)', value: 'AUD' },
                { label: 'Japanese Yen (JPY ¥)', value: 'JPY' }
            );
        const row = new ActionRowBuilder().addComponents(select);
        const reopenBtn = new ButtonBuilder()
            .setCustomId('currency_reopen')
            .setLabel('Change Currency')
            .setStyle(ButtonStyle.Secondary);
        const btnRow = new ActionRowBuilder().addComponents(reopenBtn);
        const reply = await interaction.editReply({
            embeds: [{
                color: 0x2ecc71,
                title: 'Set Deals Channel: Choose Currency',
                description: `Channel <#${channel.id}> will be used. Before finalizing, please select your preferred currency.`,
                footer: { text: 'This helps format prices correctly for your server.' }
            }],
            components: [row, btnRow]
        });
        // Schedule a timeout (10 minutes) to cancel if not selected
        const timeout = setTimeout(async () => {
            const pending = pendingChannelSetup.get(interaction.guildId);
            if (pending && pending.messageId === reply.id) {
                pendingChannelSetup.delete(interaction.guildId);
                try {
                    await interaction.editReply({
                        embeds: [{
                            color: 0xe67e22,
                            title: 'Setup Timed Out',
                            description: 'No currency was selected in time. Please run /setdealschannel again to complete setup.'
                        }],
                        components: []
                    });
                } catch { }
            }
        }, 10 * 60 * 1000);
        // Save pending setup for this guild
        pendingChannelSetup.set(interaction.guildId, { channelId: channel.id, userId: interaction.user.id, timeout, messageId: reply.id });
    }
    if (interaction.commandName === 'gaben') {
        await interaction.reply({
            embeds: [{
                title: 'We offer the best deals!',
                image: { url: 'https://cdn.discordapp.com/attachments/1413231256740823130/1413247639280947303/5d8953ed2b656.jpeg' },
                color: 0x3498db
            }]
        });
    }
    if (interaction.commandName === 'info') {
        const inviteLink = 'https://discord.com/oauth2/authorize?client_id=1413184162835202179&permissions=8&integration_type=0&scope=bot';
        await interaction.reply({
            embeds: [{
                color: 0x3498db,
                title: '🤖 Steam Deal Saver — Info',
                description:
                    'Welcome! Here\'s some info about me:\n\n'
                    + '👤 **Author:** Windows XP = 1euro8cent\n'
                    + '📅 **Created:** 01.09.2025\n'
                    + ' **Stack:** Node.js, discord.js, axios\n'
                    + '🛒 **Features:** Steam deals, alerts, game info, price history\n'
                    + '📈 **Servers Online:** ' + client.guilds.cache.size + '\n'
                    + '🔗 **Invite:** [Add me to your server](' + inviteLink + ')\n'
                    + '🌐 **Support:** https://discord.gg/JGXMbFFVYj',
                thumbnail: { url: client.user.displayAvatarURL ? client.user.displayAvatarURL() : '' },
                footer: { text: 'Steam Deal Saver • Info' }
            }]
        });
    }
    if (interaction.commandName === 'gameinfo') {
        await interaction.deferReply();
        const gameName = interaction.options.getString('name');
        try {
            // Search for the game using Steam API
            const searchRes = await axios.get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&cc=us`);
            const results = searchRes.data.items;
            if (!results || results.length === 0) {
                await interaction.editReply(`No results found for "${gameName}".`);
                return;
            }
            const game = results[0];
            // Fetch detailed info
            const detailsRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=us`);
            const details = detailsRes.data[game.id]?.data;
            if (!details) {
                await interaction.editReply('Could not fetch game details.');
                return;
            }
            // Build embed
            let tags = 'N/A';
            let featuresImages = '';
            if (details.categories && Array.isArray(details.categories)) {
                tags = details.categories.map(c => c.description).join(', ');
                // Try to add feature icons if available
                featuresImages = details.categories.map(c => c.icon ? `![${c.description}](${c.icon})` : '').filter(Boolean).join(' ');
            } else if (details.tags && Array.isArray(details.tags)) {
                tags = details.tags.join(', ');
            }
            const embed = {
                color: 0x3498db,
                title: details.name,
                url: `https://store.steampowered.com/app/${game.id}`,
                description: (details.short_description || 'No description available.') + (featuresImages ? `\n\n**Features:**\n${featuresImages}` : ''),
                thumbnail: details.header_image ? { url: details.header_image } : undefined,
                fields: [
                    { name: 'Price', value: details.is_free ? 'Free' : (details.price_overview ? details.price_overview.final_formatted : 'N/A'), inline: true },
                    { name: 'Metacritic', value: details.metacritic ? details.metacritic.score.toString() : 'N/A', inline: true },
                    { name: 'Release Date', value: details.release_date?.date || 'N/A', inline: true },
                    { name: 'Genres', value: details.genres ? details.genres.map(g => g.description).join(', ') : 'N/A', inline: false },
                    { name: 'Platforms', value: details.platforms ? Object.keys(details.platforms).filter(p => details.platforms[p]).join(', ') : 'N/A', inline: false },
                    { name: 'Tags', value: tags, inline: false },
                ]
            };
            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            await interaction.editReply('Error fetching game info.');
        }
    }
    if (interaction.commandName === 'help') {
        await interaction.reply({
            embeds: [{
                color: 0x3498db,
                title: '📖 Help — Steam Deal Saver',
                description:
                    'Here are my commands. Currency-aware ones respect your server setting.\n\n' +
                    '**Deals & Games**\n' +
                    '• 🔥 `/steamdeals` — Show Steam games with 20%+ off (currency-aware)\n' +
                    '• 🆕 `/freshgames` — Fresh & upcoming games (currency-aware)\n' +
                    '• 🎮 `/gameinfo name:<game>` — Game stats\n' +
                    '• 📈 `/gamepricehistory name:<game>` — Price history graph\n\n' +
                    '**Setup**\n' +
                    '• 📢 `/setdealschannel channel:<#channel>` — Set auto-post channel and pick currency\n' +
                    '• � `/setcurrency currency:<EUR|USD|GBP|PLN|CAD|AUD|JPY>` — Change server currency\n' +
                    '• ❌ `/removesetchannel` — Remove auto-post channel\n\n' +
                    '**Alerts**\n' +
                    '• 🔔 `/dealalerts name:<game>` — Subscribe to DM alerts\n' +
                    '• 🔕 `/unsubscribealert name:<game>` — Unsubscribe\n' +
                    '• 📋 `/listalerts` — List your alert subscriptions\n' +
                    '• 🗑️ `/clearalerts` — Clear all your alerts\n' +
                    '• ✅ `/testalert` — Test DM delivery\n\n' +
                    '• 🤖 `/gaben` — Gaben meme\n' +
                    '• 👤 `/info` — Bot info\n\n' +
                    'Need help? Join our Discord: https://discord.gg/JGXMbFFVYj',
                footer: { text: 'Steam Deal Saver • Help' }
            }]
        });
        return;
    }
    if (interaction.commandName === 'freshgames') {
        await interaction.deferReply();
        try {
            const cfg = getGuildConfig(interaction.guildId);
            const currency = cfg.currency || 'EUR';
            const embed = await getCachedFreshGamesEmbed(currency);
            await interaction.editReply(embed);
        } catch (err) {
            await interaction.editReply('Error fetching fresh games.');
        }
    }
});

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommandsForAllGuilds() {
    try {
        for (const guild of client.guilds.cache.values()) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: commands }
            );
            console.log(`Slash commands registered for guild: ${guild.id}`);
        }
    } catch (error) {
        console.error(error);
    }
}

// Per-guild configuration helpers
// File format:
// { "guilds": { [guildId]: { dealsChannelId?: string, currency?: string } } }
function readAllConfig() {
    // Prefer unified databank
    if (fs.existsSync(GUILDS_DATABANK_PATH)) {
        try {
            const data = JSON.parse(fs.readFileSync(GUILDS_DATABANK_PATH, 'utf8'));
            if (data && typeof data === 'object' && data.guilds) return data;
        } catch { }
    }
    // Migration: merge legacy config.json and deals_channels.json into new shape
    let merged = { guilds: {} };
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const legacy = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (legacy && legacy.guilds && typeof legacy.guilds === 'object') {
                merged = legacy;
            }
        }
    } catch { }
    try {
        const legacyDealsPath = './deals_channels.json';
        if (fs.existsSync(legacyDealsPath)) {
            const chans = JSON.parse(fs.readFileSync(legacyDealsPath, 'utf8'));
            const list = Array.isArray(chans?.channels) ? chans.channels : [];
            for (const entry of list) {
                if (!entry || !entry.guildId) continue;
                const g = merged.guilds[entry.guildId] || {};
                if (!g.dealsChannelId) g.dealsChannelId = entry.channelId;
                merged.guilds[entry.guildId] = g;
            }
        }
    } catch { }
    return merged;
}
function writeAllConfig(all) {
    fs.writeFileSync(GUILDS_DATABANK_PATH, JSON.stringify(all, null, 2));
}
function getGuildConfig(guildId) {
    const all = readAllConfig();
    return all.guilds[guildId] || { dealsChannelId: null, currency: 'EUR' };
}
function setGuildConfig(guildId, patch) {
    const all = readAllConfig();
    const current = all.guilds[guildId] || {};
    all.guilds[guildId] = { ...current, ...patch };
    writeAllConfig(all);
}

// Delete all stored data for a guild (config, alerts, pending setup, legacy channels)
async function deleteGuildData(guildId) {
    try {
        // Remove guild config from unified databank
        const all = readAllConfig();
        if (all.guilds && all.guilds[guildId]) {
            delete all.guilds[guildId];
            writeAllConfig(all);
        }
    } catch (e) {
        console.error('Failed to remove guild from databank:', e);
    }
    try {
        // Remove alerts scoped to this guild
        let allAlerts = [];
        const ALERTS_PATH = './deal_alerts.json';
        try {
            allAlerts = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
        } catch { allAlerts = []; }
        const filtered = allAlerts.filter(a => a.guildId !== guildId);
        fs.writeFileSync(ALERTS_PATH, JSON.stringify(filtered, null, 2));
    } catch (e) {
        console.error('Failed to clean alerts for guild:', e);
    }
    try {
        // Clean any pending channel setup for this guild
        if (pendingChannelSetup.has(guildId)) pendingChannelSetup.delete(guildId);
    } catch { }
    try {
        // Legacy cleanup: remove from deals_channels.json if still present
        const legacyDealsPath = './deals_channels.json';
        if (fs.existsSync(legacyDealsPath)) {
            let data = { channels: [] };
            try { data = JSON.parse(fs.readFileSync(legacyDealsPath, 'utf8')); } catch { }
            data.channels = (data.channels || []).filter(c => c.guildId !== guildId);
            fs.writeFileSync(legacyDealsPath, JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error('Failed legacy deals_channels cleanup:', e);
    }
}

// Currency settings mapping for Steam cc and price suffix
const CURRENCY_SETTINGS = {
    EUR: { cc: 'de', suffix: '€' },
    USD: { cc: 'us', suffix: '$' },
    GBP: { cc: 'gb', suffix: '£' },
    PLN: { cc: 'pl', suffix: 'zł' },
    CAD: { cc: 'ca', suffix: '$ CAD' },
    AUD: { cc: 'au', suffix: '$ AUD' },
    JPY: { cc: 'jp', suffix: '¥' },
};

// Steam deals cache (per currency)
const STEAM_DEALS_CACHE_TTL = 20 * 60 * 1000; // 20 minutes
const steamDealsCacheByCurrency = new Map(); // key: currency code, value: { embed, ts }

async function getCachedSteamDealsEmbed(currencyCode = 'EUR') {
    const now = Date.now();
    const key = currencyCode in CURRENCY_SETTINGS ? currencyCode : 'EUR';
    const cached = steamDealsCacheByCurrency.get(key);
    if (cached && (now - cached.ts < STEAM_DEALS_CACHE_TTL)) {
        return cached.embed;
    }
    const settings = CURRENCY_SETTINGS[key];
    const dealsEmbed = await fetchSteamDealsEmbed(settings);
    steamDealsCacheByCurrency.set(key, { embed: dealsEmbed, ts: now });
    return dealsEmbed;
}

async function fetchSteamDealsEmbed(currencySettings) {
    console.log(`[${new Date().toISOString()}] Requesting Steam API for deals...`);
    const cc = currencySettings?.cc || 'us';
    const suffix = currencySettings?.suffix || '$';
    const response = await axios.get(`https://store.steampowered.com/api/featuredcategories?cc=${cc}`);
    const specials = response.data.specials.items;
    const deals = specials.filter(game => game.discount_percent >= 20);
    if (deals.length === 0) {
        return {
            embeds: [{
                title: 'Steam Deals',
                description: 'No games found with 20% or more off.',
                color: 0x3498db
            }]
        };
    }
    // Discount emoji mapping
    const discountEmojis = {
        80: '<:80off:1413241359812526161>',
        75: '<:75off:1413241286772658367>',
        60: '<:discount60:1413229767259459634>',
        50: '<:discount50:1413229658589102151>',
        40: '<:discount40:1413229535805182032>',
        30: '<:discount30:1413229085693575320>',
        25: '<:discount25:1413229333891383418>',
        20: '<:20off:1413241536619085926>',
    };
    function getDiscountEmoji(percent) {
        // Find the closest lower or equal discount emoji
        const keys = Object.keys(discountEmojis).map(Number).sort((a, b) => b - a);
        for (const key of keys) {
            if (percent >= key) return discountEmojis[key];
        }
        return '';
    }
    // Helper to format price (Steam returns price in cents)
    function formatPrice(cents) {
        if (!cents && cents !== 0) return 'N/A';
        return (cents / 100).toFixed(2) + suffix;
    }
    // Helper to check if a game is a new release (released in last 30 days)
    function isNewRelease(game) {
        if (!game.release_date || !game.release_date.date) return false;
        const releaseDate = new Date(game.release_date.date);
        const now = new Date();
        const diffDays = (now - releaseDate) / (1000 * 60 * 60 * 24);
        return diffDays <= 30;
    }
    // Sort deals from highest to lowest discount
    deals.sort((a, b) => b.discount_percent - a.discount_percent);
    // Remove duplicate games by name
    const seenNames = new Set();
    const uniqueDeals = deals.filter(game => {
        if (seenNames.has(game.name)) return false;
        seenNames.add(game.name);
        return true;
    });
    // Build markdown table for all deals
    let table = '| % | Game | Price | Link |\n|---|------|-------|------|';
    uniqueDeals.forEach(game => {
        let emojiPrefix = '🎮';
        if (game.discount_percent >= 50) emojiPrefix = '🔥';
        else if (isNewRelease(game)) emojiPrefix = '🆕';
        let priceInfo = '';
        if (game.original_price && game.final_price) {
            priceInfo = `~~${formatPrice(game.original_price)}~~ → **${formatPrice(game.final_price)}**`;
        } else {
            priceInfo = 'N/A';
        }
        table += `\n| ${game.discount_percent}% | ${emojiPrefix} ${getDiscountEmoji(game.discount_percent)} ${game.name} | ${priceInfo} | [Link](https://store.steampowered.com/app/${game.id}) |`;
    });
    return {
        embeds: [{
            title: '💸 Steam Deals (20%+ off)',
            color: 0x3498db,
            description: table,
            timestamp: new Date().toISOString(),
            footer: { text: 'Steam Deal Saver • Last updated' }
        }]
    };
}

// Cache for posted new games
let postedFreshGames = new Set();

// Fresh games cache per currency
const freshGamesCacheByCurrency = new Map(); // key: currency code, value: { embed, ts }
const FRESH_GAMES_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

async function getCachedFreshGamesEmbed(currencyCode = 'EUR') {
    const now = Date.now();
    const key = currencyCode in CURRENCY_SETTINGS ? currencyCode : 'EUR';
    const cached = freshGamesCacheByCurrency.get(key);
    if (cached && (now - cached.ts < FRESH_GAMES_CACHE_TTL)) {
        return cached.embed;
    }
    const settings = CURRENCY_SETTINGS[key];
    const embed = await getFreshGamesAndUpcomingEmbed(settings);
    freshGamesCacheByCurrency.set(key, { embed, ts: now });
    return embed;
}

async function getFreshGamesAndUpcomingEmbed(currencySettings) {
    const cc = currencySettings?.cc || 'us';
    const suffix = currencySettings?.suffix || '$';
    const response = await axios.get(`https://store.steampowered.com/api/featuredcategories?cc=${cc}`);
    const specials = response.data.specials.items;
    // Use Steam search API for upcoming unreleased games (region-aware if possible)
    let upcomingGames = [];
    try {
        const searchRes = await axios.get('https://store.steampowered.com/search/results/', {
            params: {
                query: '',
                category1: 998, // Games only
                sort_by: 'Released_DESC',
                filter: 'comingsoon',
                cc,
                page: 1
            }
        });
        const html = searchRes.data;
        const regex = new RegExp('<a[^>]*href="https://store\\.steampowered\\.com/app/(\\d+)"[^>]*>\\s*<div[^>]*class="col search_name ellipsis"[^>]*>\\s*<span[^>]*>([^<]+)<\\/span>', 'g');
        let match;
        while ((match = regex.exec(html)) !== null) {
            upcomingGames.push({
                id: match[1],
                name: match[2],
                release_date: 'TBA'
            });
        }
    } catch { }
    const nowDate = new Date();
    // Fresh released games
    const freshGames = specials.filter(game => {
        if (!game.release_date || !game.release_date.date) return false;
        const releaseDate = new Date(game.release_date.date);
        const diffDays = (nowDate - releaseDate) / (1000 * 60 * 60 * 24);
        return diffDays <= 30 && !postedFreshGames.has(game.id);
    });
    const formatPrice = (cents) => {
        if (!cents && cents !== 0) return 'N/A';
        return (cents / 100).toFixed(2) + suffix;
    };
    let table = '| Game | Release Date | Price | Link |\n|---|---|---|---|';
    let hasFresh = false;
    freshGames.forEach(game => {
        let priceInfo = '';
        if (game.original_price && game.final_price) {
            priceInfo = `~~${formatPrice(game.original_price)}~~ → **${formatPrice(game.final_price)}**`;
        } else {
            priceInfo = 'N/A';
        }
        table += `\n| ${game.name} | ${game.release_date.date} | ${priceInfo} | [Link](https://store.steampowered.com/app/${game.id}) |`;
        postedFreshGames.add(game.id);
        hasFresh = true;
    });
    // Upcoming unreleased games
    let unreleasedList = '| Game | Release Date | Link |\n|---|---|---|';
    let hasUpcoming = false;
    upcomingGames.forEach(g => {
        unreleasedList += `\n| ${g.name} | ${g.release_date || 'TBA'} | [Link](https://store.steampowered.com/app/${g.id}) |`;
        hasUpcoming = true;
    });
    let description = '';
    if (hasFresh) {
        description += table;
    } else {
        description += 'No new releases found in the last 30 days.';
    }
    if (hasUpcoming) {
        description += `\n\n**Upcoming Unreleased Games:**\n${unreleasedList}`;
    } else {
        description += '\n\nNo upcoming unreleased games found.';
    }
    return {
        embeds: [{
            title: '🆕 Fresh & Upcoming Steam Games',
            color: 0x3498db,
            description,
            timestamp: new Date().toISOString(),
            footer: { text: 'Steam Deal Saver • Last updated' }
        }]
    };
}

client.on('ready', async () => {
    CLIENT_ID = client.user.id;
    GUILD_IDS = Array.from(client.guilds.cache.keys());
    console.log(`Logged in as ${client.user.tag}`);
    // Set bot status to 'Listening to steam deals'
    client.user.setActivity('steam deals', { type: 'LISTENING' });
    await registerCommandsForAllGuilds();
    // Schedule auto posting every 2 hours (per guild)
    setInterval(async () => {
        for (const [guildId] of client.guilds.cache) {
            const cfg = getGuildConfig(guildId);
            if (!cfg.dealsChannelId) continue;
            const channel = await client.channels.fetch(cfg.dealsChannelId).catch(() => null);
            if (!channel) continue;
            // Delete last bot message if exists
            try {
                const messages = await channel.messages.fetch({ limit: 10 });
                const lastBotMsg = messages.find(m => m.author.id === client.user.id);
                if (lastBotMsg) await lastBotMsg.delete();
            } catch (err) {
                console.error('Could not delete last bot message:', err);
            }
            try {
                const dealsEmbed = await getCachedSteamDealsEmbed(cfg.currency || 'EUR');
                await channel.send(dealsEmbed);
            } catch { }
        }
    }, 2 * 60 * 60 * 1000); // Every 2 hours
});



client.login(DISCORD_TOKEN);
