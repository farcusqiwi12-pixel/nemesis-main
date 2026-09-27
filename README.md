# NEMESIS

NEMESIS is a dark multiplayer black-market game built around cases, collection, equipment, a player market and direct trading.

## v1.1.0 UI/gameplay update

- Reworked the visual style into a darker terminal/black-market interface.
- Added a persistent dashboard with balance, online count, cases opened and server status.
- Added a daily reward UI using the existing `/api/daily-reward` system.
- Added daily reward status endpoint.
- Improved case cards and opening presentation without changing the server-side drop logic.
- Added inventory search and clearer item stats.
- Improved character/loadout presentation and calculated defense/damage/backpack slots from existing item data.
- Added player search and live trade state loading.
- Improved marketplace filters, cards and purchase feedback.
- Added toast notifications and a mobile layout pass.
- Removed the accidental browser load of the server-only `trade.js` module.
- Added lightweight local WAV SFX so the existing sound hooks work without external assets.
- Kept `render.yaml`, PostgreSQL schema and existing API contracts intact except for additive endpoints.

## Render

The existing Render setup remains:

```text
npm install
npm start
```

`npm start` runs `bootstrap.js` and then `server.js`.

Required root files:

- `package.json`
- `render.yaml`
- `bootstrap.js`
- `db.sql`
- `seed.sql`
- `server.js`

Do not delete the existing PostgreSQL database when deploying an update.


## NEMESIS 1.2.1

- Starting balance for new accounts: 2500 ₦
- 8 active case containers with additional drop pools
- Cinematic container opening: no roulette/scrolling; lid unlocks and opens, then rarity glow reveals the item
- Quick sell directly from a drop result and inventory
- Player market remains available for custom pricing
- Idempotent `upgrade.sql` runs during bootstrap without deleting existing player data
- Optional developer account is created by setting `DEVELOPER_PASSWORD` in the Render environment

## v1.2.2 — Case opening balance fix

- Fixed a false `Недостаточно средств` message caused by a stale client-side balance.
- Case purchases are now validated authoritatively by PostgreSQL/server state.
- The server returns the new balance immediately after a successful case opening.
- The displayed balance is refreshed after opening a case.
- This is especially important for the NEMESIS_DEV account and for sessions opened in multiple browser tabs.


## NEMESIS 1.3.0 — Black Market Expansion

This release is additive to v1.2.2 and keeps the existing authentication, cases, inventory, character, market and trade systems.

### Added
- NEMESIS rarity and expanded item metadata: category, equip slot, market value, weight, condition and upgrade level.
- Meaningful item stats and Loadout value/power/weight calculations.
- Upgrade and dismantle systems.
- XP, levels, progression, daily/weekly contracts and achievements.
- Heat and raid statistics.
- Black Run: risk selection, loot caches, PvP hunt encounters, extraction and loss states.
- Black Run loot becomes real inventory items only after successful extraction.
- New Black Market / Epic / Legendary / NEMESIS cases and rare NEMESIS items.
- Market filtering foundations for Power and condition.
- Additional PostgreSQL indexes and additive tables for progression, price history, runs and seasonal data.
- PostgreSQL pool reuse remains enabled and configurable with `PG_POOL_MAX`.

### Compatibility
- `upgrade.sql` is repeatable and does not delete existing player data.
- Existing APIs and pages remain in place; new endpoints are additive.
- PvP is currently implemented as a server-authoritative Black Run encounter layer; a full real-time player-vs-player combat client can be added on top of this raid foundation without replacing the economy systems.
