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
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import QuickChart from 'quickchart-js';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
let CLIENT_ID;
let GUILD_IDS = [];
const CONFIG_PATH = './config.json';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Register slash commands for all guilds after login
const commands = [
    new SlashCommandBuilder().setName('steamdeals').setDescription('Show Steam games with 20%+ off'),
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
].map(cmd => cmd.toJSON());

// Deal alert subscription storage
function getAlerts(guildId) {
    const ALERTS_PATH = `./alerts_${guildId}.json`;
    try {
        return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
    } catch {
        return [];
    }
}
function setAlerts(guildId, alerts) {
    const ALERTS_PATH = `./alerts_${guildId}.json`;
    if (!Array.isArray(alerts)) alerts = [];
    fs.writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2));
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
    // Rate limit all commands except 'help'
    if (interaction.commandName !== 'help' && isRateLimited(interaction.user.id, interaction.commandName, 5000)) {
        await interaction.reply({ content: 'You are doing that too fast. Please wait a few seconds.', ephemeral: true });
        return;
    }
    // Restrict setup commands to admins only
    if (!interaction.member.permissions.has('Administrator')) {
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
    // Periodically check for deals and send alerts
    // Check Steam API for alerts every 30 minutes
    setInterval(async () => {
        for (const [guildId] of client.guilds.cache) {
            const alerts = getAlerts(guildId);
            if (!alerts.length) continue;
            let deals = [];
            try {
                deals = await fetchSteamDeals();
            } catch {
                continue;
            }
            for (const alert of alerts) {
                const match = deals.find(d => d.name.toLowerCase().includes(alert.gameName.toLowerCase()));
                if (match) {
                    try {
                        const user = await client.users.fetch(alert.userId);
                        await user.send(`Deal alert! "${match.name}" is now on sale: ${match.discount_percent}% off for ${match.final_price}€\n${match.url}`);
                    } catch { }
                }
            }
            // Remove alerts that have been sent
            const remaining = alerts.filter(alert => {
                return !deals.some(d => d.name.toLowerCase().includes(alert.gameName.toLowerCase()));
            });
            setAlerts(guildId, remaining);
            // Clean up alerts for inactive users (>15 days)
            const now = Date.now();
            const fifteenDays = 15 * 24 * 60 * 60 * 1000;
            const expired = alerts.filter(a => now - (a.lastActive || 0) > fifteenDays);
            if (expired.length) {
                for (const alert of expired) {
                    try {
                        const user = await client.users.fetch(alert.userId);
                        await user.send('Your Steam deal alert subscription has been removed due to 15 days of inactivity. You can resubscribe anytime.');
                    } catch { }
                }
                const activeAlerts = getAlerts(guildId).filter(a => !expired.some(e => e.userId === a.userId && e.gameName === a.gameName));
                setAlerts(guildId, activeAlerts);
            }
        }
    }, 30 * 60 * 1000); // Check every 30 minutes
    if (interaction.commandName === 'removesetchannel') {
        await interaction.deferReply();
        const config = getConfig();
        if (!config.dealsChannelId) {
            await interaction.editReply('No auto-posting channel is currently set.');
            return;
        }
        delete config.dealsChannelId;
        setConfig(config);
        await interaction.editReply('Auto-posting Steam deals channel has been removed.');
        return;
    }
    if (!interaction.isChatInputCommand()) return;
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
        let dealsEmbed = null;
        let usedCache = false;
        try {
            dealsEmbed = await getCachedSteamDealsEmbed();
        } catch (err) {
            dealsEmbed = null;
        }
        if (!dealsEmbed) {
            await interaction.editReply('Error fetching Steam deals.');
            return;
        }
        // Try to fetch fresh data for alerts, fallback to cache if needed
        let deals = [];
        try {
            deals = await fetchSteamDeals();
        } catch {
            usedCache = true;
        }
        await interaction.editReply({
            content: usedCache ? '⚠️ Showing cached Steam deals due to API error.' : null,
            embeds: dealsEmbed.embeds
        });
        // Alerts logic (unchanged)
        const alerts = getAlerts();
        for (const alert of alerts) {
            const match = deals.find(d => d.name.toLowerCase().includes(alert.gameName.toLowerCase()));
            if (match) {
                try {
                    const user = await client.users.fetch(alert.userId);
                    await user.send(`Deal alert! "${match.name}" is now on sale: ${match.discount_percent}% off for ${match.final_price}€\n${match.url}`);
                } catch { }
            }
        }
        // Remove alerts that have been sent
        const remaining = alerts.filter(alert => {
            return !deals.some(d => d.name.toLowerCase().includes(alert.gameName.toLowerCase()));
        });
        setAlerts(remaining);
    }
    if (interaction.commandName === 'setdealschannel') {
        await interaction.deferReply();
        const channel = interaction.options.getChannel('channel');
        if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
            await interaction.editReply('Please select a valid text channel.');
            return;
        }
        const config = getConfig();
        config.dealsChannelId = channel.id;
        setConfig(config);
        await interaction.editReply(`Channel <#${channel.id}> is now set for automatic Steam deals posting.`);
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
        const inviteLink = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot+applications.commands&permissions=274877975552`;
        await interaction.reply({
            embeds: [{
                color: 0x3498db,
                title: 'Bot Info',
                fields: [
                    { name: 'Author', value: 'Windows XP = 1euro8cent', inline: false },
                    { name: 'Bot Creation Date', value: '01.09.2025', inline: false },
                    { name: 'Invite Link', value: `[Invite me to your server to secure more deals!](${inviteLink})`, inline: false }
                ]
            }]
        });
    }
    if (interaction.commandName === 'gamegraph') {
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
            const appId = game.id;
            // SteamDB price history graph image URL
            const graphUrl = `https://steamdb.info/graph/${appId}/price/`;
            const embed = {
                color: 0x3498db,
                title: `${game.name} Price History (SteamDB)`,
                url: `https://steamdb.info/app/${appId}/`,
                description: `Price history graph for **${game.name}** from SteamDB.`,
                image: { url: `https://steamdb.info/graph/${appId}/price.png` },
                footer: { text: 'Source: steamdb.info' }
            };
            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            await interaction.editReply('Error fetching price history graph.');
        }
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
            const embed = {
                color: 0x3498db,
                title: details.name,
                url: `https://store.steampowered.com/app/${game.id}`,
                description: details.short_description || 'No description available.',
                thumbnail: details.header_image ? { url: details.header_image } : undefined,
                fields: [
                    { name: 'Price', value: details.is_free ? 'Free' : (details.price_overview ? details.price_overview.final_formatted : 'N/A'), inline: true },
                    { name: 'Metacritic', value: details.metacritic ? details.metacritic.score.toString() : 'N/A', inline: true },
                    { name: 'Release Date', value: details.release_date?.date || 'N/A', inline: true },
                    { name: 'Genres', value: details.genres ? details.genres.map(g => g.description).join(', ') : 'N/A', inline: false },
                    { name: 'Platforms', value: details.platforms ? Object.keys(details.platforms).filter(p => details.platforms[p]).join(', ') : 'N/A', inline: false },
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
                title: 'Bot Help',
                description:
                    `**/steamdeals** - Show Steam games with 20%+ off

                    **/setdealschannel** - Set this channel for automatic Steam deals posting

**/removesetchannel** - Remove the auto-posting Steam deals channel

**/gaben** - Sends a Gaben deals meme

**/info** - Show bot info

**/gameinfo name:<game name>** - Show stats for a Steam game

**/gamepricehistory name:<game name>** - Show price history for a Steam game

**/freshgames** - Show new and upcoming Steam games (no repeats)

**/dealalerts name:<game name>** - Subscribe for DM alerts when a specific game goes on sale

**/unsubscribealert name:<game name>** - Unsubscribe from DM deal alerts for a specific game

**/listalerts** - List all games you are subscribed to for deal alerts

**/clearalerts** - Clear all your deal alert subscriptions

**/testalert** - Send a test DM alert to yourself to verify alert delivery

**/help** - Show this help message`,
                footer: { text: 'Steam Seller Bot Help' }
            }]
        });
        return;
    }
    if (interaction.commandName === 'freshgames') {
        await interaction.deferReply();
        try {
            const embed = await getCachedFreshGamesEmbed();
            // Fetch upcoming unreleased games from Steam API
            let upcomingGames = [];
            try {
                const res = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=us');
                upcomingGames = res.data.upcoming?.items || [];
            } catch { }
            // Format upcoming unreleased games
            if (upcomingGames.length) {
                let unreleasedList = '| Game | Release Date | Link |\n|---|---|---|';
                upcomingGames.forEach(g => {
                    unreleasedList += `\n| ${g.name} | ${g.release_date || 'TBA'} | [Link](https://store.steampowered.com/app/${g.id}) |`;
                });
                if (embed.embeds && embed.embeds[0]) {
                    embed.embeds[0].description += `\n\n**Upcoming Unreleased Games:**\n${unreleasedList}`;
                } else {
                    embed.content = (embed.content || '') + `\n\n**Upcoming Unreleased Games:**\n${unreleasedList}`;
                }
            }
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

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return { dealsChannelId: null };
    return JSON.parse(fs.readFileSync(CONFIG_PATH));
}
function setConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Steam deals cache
let steamDealsCache = null;
let steamDealsCacheTimestamp = 0;
const STEAM_DEALS_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

async function getCachedSteamDealsEmbed() {
    const now = Date.now();
    if (steamDealsCache && (now - steamDealsCacheTimestamp < STEAM_DEALS_CACHE_TTL)) {
        return steamDealsCache;
    }
    const dealsEmbed = await fetchSteamDealsEmbed();
    steamDealsCache = dealsEmbed;
    steamDealsCacheTimestamp = now;
    return dealsEmbed;
}

async function fetchSteamDealsEmbed() {
    console.log(`[${new Date().toISOString()}] Requesting Steam API for deals...`);
    const response = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=us');
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
    // Helper to format price in EUR (Steam returns price in cents)
    function formatPrice(cents) {
        if (!cents && cents !== 0) return 'N/A';
        return (cents / 100).toFixed(2) + '€';
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
    // Build markdown table for all deals
    let table = '| % | Game | Price | Link |\n|---|------|-------|------|';
    deals.forEach(game => {
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
            title: 'Steam Deals (-20% or more)',
            color: 0x3498db,
            description: table,
            timestamp: new Date().toISOString(),
            footer: { text: 'Last updated' }
        }]
    };
}

// Cache for posted new games
let postedFreshGames = new Set();

// Fresh games cache
let freshGamesCache = null;
let freshGamesCacheTimestamp = 0;
const FRESH_GAMES_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

async function getCachedFreshGamesEmbed() {
    const now = Date.now();
    if (freshGamesCache && (now - freshGamesCacheTimestamp < FRESH_GAMES_CACHE_TTL)) {
        return freshGamesCache;
    }
    const embed = await getFreshGamesAndUpcomingEmbed();
    freshGamesCache = embed;
    freshGamesCacheTimestamp = now;
    return embed;
}

async function getFreshGamesAndUpcomingEmbed() {
    const response = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=us');
    const specials = response.data.specials.items;
    // Use Steam search API for upcoming unreleased games
    let upcomingGames = [];
    try {
        const searchRes = await axios.get('https://store.steampowered.com/search/results/', {
            params: {
                query: '',
                category1: 998, // Games only
                sort_by: 'Released_DESC',
                filter: 'comingsoon',
                cc: 'us',
                page: 1
            }
        });
        // Parse HTML response for upcoming games
        const html = searchRes.data;
        const regex = /<a[^>]*href="https:\/\/store\.steampowered\.com\/app\/(\d+)"[^>]*>\s*<div[^>]*class="col search_name ellipsis"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            upcomingGames.push({
                id: match[1],
                name: match[2],
                release_date: 'TBA'
            });
        }
    } catch { }
    const now = new Date();
    // Fresh released games
    const freshGames = specials.filter(game => {
        if (!game.release_date || !game.release_date.date) return false;
        const releaseDate = new Date(game.release_date.date);
        const diffDays = (now - releaseDate) / (1000 * 60 * 60 * 24);
        return diffDays <= 30 && !postedFreshGames.has(game.id);
    });
    let table = '| Game | Release Date | Price | Link |\n|---|---|---|---|';
    let hasFresh = false;
    freshGames.forEach(game => {
        let priceInfo = '';
        if (game.original_price && game.final_price) {
            priceInfo = `~~${(game.original_price / 100).toFixed(2)}€~~ → **${(game.final_price / 100).toFixed(2)}€**`;
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
            title: 'Fresh & Upcoming Steam Games',
            color: 0x3498db,
            description,
            timestamp: new Date().toISOString(),
            footer: { text: 'Last updated' }
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
    // Schedule auto posting every 6 hours
    setInterval(async () => {
        const config = getConfig();
        if (config.dealsChannelId) {
            const channel = await client.channels.fetch(config.dealsChannelId);
            if (channel) {
                // Delete last bot message if exists
                try {
                    const messages = await channel.messages.fetch({ limit: 10 });
                    const lastBotMsg = messages.find(m => m.author.id === client.user.id);
                    if (lastBotMsg) await lastBotMsg.delete();
                } catch (err) {
                    console.error('Could not delete last bot message:', err);
                }
                const dealsEmbed = await getCachedSteamDealsEmbed();
                channel.send(dealsEmbed);
            }
        }
    }, 2 * 60 * 60 * 1000); // Every 2 hours
});



client.login(DISCORD_TOKEN);
