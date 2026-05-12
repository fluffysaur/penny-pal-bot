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
cd apps/expense-bot
npm install
cp .env.template .env
```

## Environment Variables

- `TELEGRAM_TOKEN`: Telegram bot token
- `NOTION_TOKEN`: Notion integration token
- `EXPENSE_BOT_ALLOWED_USER_IDS`: Comma-separated Telegram user IDs allowed to use the bot
- `EXPENSE_BOT_DEFAULT_DB_ID`: Fallback Notion database ID
- `EXPENSE_BOT_USER_DB_MAP_JSON`: JSON object mapping user ID to Notion DB ID
- `EXPENSE_BOT_DB_LABELS_JSON`: JSON object mapping Notion DB ID to display label
- `EXPENSE_BOT_PROCESS_TIMEOUT`: Timeout for process-level operations
- `EXPENSE_BOT_HERMES_TIMEOUT`: Timeout for vision integration operations

## Run Locally

```bash
cd apps/expense-bot
set -a; source .env; set +a
npm run dev
```

## Build

```bash
npm run build
npm start
```

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
