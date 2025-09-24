# Steam Deal Saver — Privacy Policy

Last updated: 2025-09-24

This Privacy Policy explains what information the Steam Deal Saver Discord bot (the “Bot”) collects, how it is used, and your choices. By adding or using the Bot, you agree to this policy.

This document describes how the Bot behaves as implemented in this repository. It is not legal advice.

## What data we collect

The Bot only collects the minimum information necessary to operate its features.

- Server (Guild) configuration
  - Guild ID
  - Deals channel ID (if configured)
  - Preferred currency for price display
  - Update-log opt-in status (guild ID added to a list if opted in)
  - Storage: kept in local JSON files in the bot’s hosting environment (e.g., `guilds_databank.json`, `update_optin_guilds.json`).

- User-provided alert subscriptions
  - User ID (Discord), game name(s) you subscribe to, a lastActive timestamp to keep subscriptions healthy
  - Storage: local JSON file (`deal_alerts.json`).

- Command usage and operational logs
  - The Bot logs the command name and the guild context to the console (e.g., “/steamdeals used in guild …”).
  - These logs are not intentionally persisted by the Bot to disk, but your hosting environment or process manager might capture console output.

- Transient caches
  - For performance, the Bot caches public game/deal data in memory. This does not include personal data and is not written to disk.

- External services
  - The Bot queries public APIs (e.g., Steam, IsThereAnyDeal, QuickChart). It shares game titles or app IDs you request but does not send your personal data to those services.

## How we use data

- Provide features you request (e.g., show deals, price history, game info)
- Send deal alert DMs you subscribed to
- Post automatic deal updates to a configured server channel
- Post update logs to servers that opted in
- Maintain stability, troubleshoot issues, and prevent abuse (basic logging and rate limiting)

## Legal bases (where applicable)

- Consent: For update log posts, servers choose to opt in via an explicit button.
- Contract/Legitimate Interest: To provide the features you invoke via commands and maintain service quality and security.

## Retention

- Server configuration persists until the server removes or changes it, or the Bot is removed from the server.
- Alert subscriptions persist until you unsubscribe or clear them.
- When the Bot is removed from a server, it automatically purges that server’s configuration and any associated alerts from local storage.
- Console logs are transient; retention depends on your hosting setup.

## Sharing

We do not sell or share personal data with third parties. Public API providers may receive the game titles or app IDs you query. We do not transmit your Discord user IDs or guild IDs to them.

## Children’s privacy

The Bot is intended for Discord users who meet Discord’s minimum age requirements (e.g., 13+ in many regions). We do not knowingly collect information from children under the minimum age allowed by Discord.

## Your choices and rights

- Unsubscribe from alerts with `/unsubscribealert` or `/clearalerts`.
- Server admins can remove the Bot to immediately delete server-scoped data.
- You may request access to or deletion of your data by contacting us (see Contact section below). We may need to verify your ownership of the relevant Discord account or server.

## Security

We use reasonable measures to protect stored data (local JSON files). However, no method of transmission or storage is 100% secure. Use the Bot at your own risk.

## Changes to this policy

We may update this policy from time to time. Material changes may be announced in the support server and/or via update logs (to servers that opted in).

## Contact

- Support server: https://discord.gg/JGXMbFFVYj
- Bot owner (Discord ID): 1073250313726857337

If you are a server admin and require a data processing clarification or removal, please reach out via the support server.
