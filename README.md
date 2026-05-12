# Penny Pal Bot

TypeScript rewrite of a Telegram expense logging bot that parses transaction images, allows review/editing, and submits approved rows to Notion.

## Status

- Primary runtime is now Node 22 + TypeScript.
- Legacy Python implementation is preserved in `legacy/python/` during migration.

## Requirements

- Node.js 22+
- npm 10+
- Telegram bot token (BotFather)
- Notion integration token and database IDs

## Setup

```bash
cd apps/penny-pal-bot
npm install
cp .env.template .env
```

## Environment Variables

- `TELEGRAM_TOKEN`: Telegram bot token
- `NOTION_TOKEN`: Notion integration token
- `EXPENSE_BOT_ALLOWED_USER_IDS`: Comma-separated Telegram user IDs allowed to use the bot
- `EXPENSE_BOT_DEFAULT_DB_ID`: Fallback Notion database ID
- `EXPENSE_BOT_USER_DB_MAP_JSON`: JSON object mapping user ID to Notion DB ID
- `EXPENSE_BOT_USER_NAMES_JSON`: JSON object mapping user ID to display name
- `EXPENSE_BOT_DB_LABELS_JSON`: JSON object mapping Notion DB ID to display label
- `EXPENSE_BOT_PROCESS_TIMEOUT`: Process timeout in seconds (default: `300`)
- `EXPENSE_BOT_HERMES_TIMEOUT`: Vision timeout in seconds (default: `240`)

Example:

```env
TELEGRAM_TOKEN=123456:abcDEF
NOTION_TOKEN=secret_abc123
EXPENSE_BOT_ALLOWED_USER_IDS=12345678,87654321
EXPENSE_BOT_DEFAULT_DB_ID=abc123def456
EXPENSE_BOT_USER_DB_MAP_JSON={"12345678":"abc123def456"}
EXPENSE_BOT_USER_NAMES_JSON={"12345678":"Alice"}
EXPENSE_BOT_DB_LABELS_JSON={"abc123def456":"Personal"}
EXPENSE_BOT_PROCESS_TIMEOUT=300
EXPENSE_BOT_HERMES_TIMEOUT=240
```

## Run Locally

```bash
cd apps/penny-pal-bot
npm run dev
```

The app loads `.env` automatically via `dotenv/config`.

## Build

```bash
npm run build
npm start
```

## Run Persistently (PM2)

Use PM2 in production so the bot restarts on crashes and server reboots.

```bash
# one-time install
npm install -g pm2

# from repo root
cd apps/penny-pal-bot
npm ci
npm run build

# run persistently
pm2 start npm --name penny-pal-bot -- start

# save process list and enable startup on reboot
pm2 save
pm2 startup
```

Common PM2 commands:

- `pm2 status`
- `pm2 logs penny-pal-bot`
- `npm run build && pm2 restart penny-pal-bot`
- `pm2 stop penny-pal-bot`

## Test

```bash
npm test
npm run typecheck
```

## CI

Workflow at `.github/workflows/test.yml` runs `npm ci`, `npm run typecheck`, and `npm test`.

## Project Layout

- `src/`: TypeScript source
- `test/`: Vitest tests
- `legacy/python/`: Preserved Python implementation
- `logs/`: Runtime logs (ignored by git)
- `state/`: Runtime state (learned categories)
