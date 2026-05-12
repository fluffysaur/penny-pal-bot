#!/usr/bin/env python3
"""Telegram expense bot with parsing, structured editing, category clarification, and Notion submission."""

import asyncio
import contextlib
import difflib
import json
import logging
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import requests
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatAction
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from penny_pal_bot.category_helpers import (
    build_category_clarification_text,
    find_ambiguous_categories,
    normalize_key,
    normalize_rows_categories,
    remember_category_mapping,
)
from penny_pal_bot.expense_signs import normalize_rows as normalize_signed_rows

logging.basicConfig(level=logging.INFO)
LOG = logging.getLogger(__name__)

def _parse_allowed_ids(raw: str):
    ids = set()
    for token in (raw or '').split(','):
        token = token.strip()
        if not token:
            continue
        try:
            ids.add(int(token))
        except ValueError:
            LOG.warning('Ignoring invalid EXPENSE_BOT_ALLOWED_USER_IDS value: %s', token)
    return ids


def _parse_user_db_map(raw: str):
    if not raw:
        return {}
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        LOG.warning('EXPENSE_BOT_USER_DB_MAP_JSON is not valid JSON')
        return {}
    if not isinstance(loaded, dict):
        LOG.warning('EXPENSE_BOT_USER_DB_MAP_JSON must be a JSON object')
        return {}
    parsed = {}
    for key, value in loaded.items():
        try:
            parsed[int(str(key))] = str(value)
        except ValueError:
            LOG.warning('Ignoring invalid user id key in EXPENSE_BOT_USER_DB_MAP_JSON: %s', key)
    return parsed


def _parse_db_labels(raw: str):
    if not raw:
        return {}
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        LOG.warning('EXPENSE_BOT_DB_LABELS_JSON is not valid JSON')
        return {}
    if not isinstance(loaded, dict):
        LOG.warning('EXPENSE_BOT_DB_LABELS_JSON must be a JSON object')
        return {}
    return {str(key): str(value) for key, value in loaded.items()}

APP_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = APP_DIR / 'penny_pal_bot'
LOG_DIR = APP_DIR / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)
SUBMIT_SCRIPT = APP_DIR / 'submit_rows.py'
PROCESS_IMAGE_SCRIPT = PACKAGE_DIR / 'process_image.py'
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
NOTION_TOKEN = os.getenv('NOTION_TOKEN')
ALLOWED_IDS = _parse_allowed_ids(os.getenv('EXPENSE_BOT_ALLOWED_USER_IDS', ''))
SENDER_DB_MAP = _parse_user_db_map(os.getenv('EXPENSE_BOT_USER_DB_MAP_JSON', '{}'))
DEFAULT_DB = os.getenv('EXPENSE_BOT_DEFAULT_DB_ID', '').strip()
DB_LABELS = _parse_db_labels(os.getenv('EXPENSE_BOT_DB_LABELS_JSON', '{}'))
NOTION_VERSION = '2022-06-28'
NOTION_BASE_URL = 'https://api.notion.com/v1'


def target_info_for_user(user_id: int):
    target_db = SENDER_DB_MAP.get(user_id, DEFAULT_DB)
    target_label = DB_LABELS.get(target_db, 'Unknown')
    return target_db, target_label


def extract_json_array(text: str):
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ('rows', 'result', 'data', 'content', 'text'):
                value = parsed.get(key)
                if isinstance(value, list):
                    return value
                if isinstance(value, str):
                    try:
                        nested = json.loads(value)
                        if isinstance(nested, list):
                            return nested
                    except Exception:
                        pass
    except Exception:
        pass

    first = text.find('[')
    last = text.rfind(']')
    if first != -1 and last != -1 and last > first:
        try:
            parsed = json.loads(text[first:last + 1])
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    return []


def notion_headers():
    if not NOTION_TOKEN:
        return None
    return {
        'Authorization': f'Bearer {NOTION_TOKEN}',
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
    }


def notion_get(path):
    headers = notion_headers()
    if not headers:
        return None
    resp = requests.get(f'{NOTION_BASE_URL}{path}', headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def notion_post(path, payload):
    headers = notion_headers()
    if not headers:
        return None
    resp = requests.post(f'{NOTION_BASE_URL}{path}', headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def extract_title_from_page(page):
    props = page.get('properties', {})
    for prop in props.values():
        if prop.get('type') == 'title':
            return ''.join(chunk.get('plain_text') or chunk.get('text', {}).get('content', '') for chunk in prop.get('title', [])).strip()
    return ''


def fetch_relation_options(target_db):
    if not NOTION_TOKEN:
        return []
    try:
        schema = notion_get(f'/databases/{target_db}')
        category_prop = schema.get('properties', {}).get('Category', {})
        relation_info = category_prop.get('relation', {})
        relation_db_id = relation_info.get('database_id')
        if not relation_db_id:
            return []
        query = notion_post(f'/databases/{relation_db_id}/query', {'page_size': 100})
        results = query.get('results', []) if isinstance(query, dict) else []
        titles = []
        for page in results:
            title = extract_title_from_page(page)
            if title:
                titles.append(title)
        return titles
    except Exception:
        LOG.exception('Failed to fetch relation options for %s', target_db)
        return []


def success_message(target_label: str):
    return f'Expenses logged! Thank you, {target_label} 🤑'


def start_message(target_label: str):
    return f"Hello, {target_label}! Send me a receipt or screenshot of your transactions and I'll log them for you ☺️."


def help_message():
    return (
        'Here’s what I can do:\n'
        '/start — show the welcome message\n'
        '/help — show this help message\n'
        '/manual — manually log one or more entries\n'
        '/cancel — cancel the current draft or edit flow\n\n'
        'You can also:\n'
        '- send a receipt or transaction screenshot\n'
        '- use the buttons to approve or edit parsed rows\n'
        '- send free-form edit instructions while reviewing rows\n\n'
        'Manual entry formats:\n'
        '1) item | amount | category | date | remarks\n'
        '2) item amount category [date] [remarks]\n\n'
        'Examples:\n'
        'Coffee | 4.50 | Food | 2026-05-04 | team lunch\n'
        'Bus ride | 1.23 | Transport\n'
        'Bubble Tea 6.80 Food\n'
        'Bus 1.20 Transport\n'
        'Tithe | 50 | Tithing | 2026-05-04'
    )


def approve_in_progress_message(target_label: str):
    return f'Hold tight, {target_label} — updating your expense log...'


def manual_prompt_message(target_label: str):
    return (
        f'{target_label}, send one or more manual entries in either format:\n'
        '1) item | amount | category | date | remarks\n'
        '2) item amount category [date] [remarks]\n\n'
        'Date and remarks are optional. Send one entry per line.\n'
        'Examples:\n'
        'Coffee | 4.50 | Food | 2026-05-04 | team lunch\n'
        'Bus ride | 1.23 | Transport\n'
        'Bubble Tea 6.80 Food\n'
        'Bus 1.20 Transport'
    )


def today_iso():
    return date.today().isoformat()


def parse_manual_entries(text: str):
    rows = []
    for raw_line in str(text or '').splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if '|' in line:
            parts = [part.strip() for part in line.split('|')]
            if len(parts) < 3:
                raise ValueError('Each manual entry must include at least item, amount, and category.')
            item, amount_text, category = parts[:3]
            entry_date = parts[3] if len(parts) >= 4 and parts[3] else today_iso()
            remarks = '|'.join(parts[4:]).strip() if len(parts) >= 5 else ''
        else:
            tokens = line.split()
            if len(tokens) < 3:
                raise ValueError('Each manual entry must include at least item, amount, and category.')
            amount_idx = None
            for idx, token in enumerate(tokens):
                try:
                    float(token.replace(',', '').strip())
                    amount_idx = idx
                    break
                except ValueError:
                    continue
            if amount_idx is None or amount_idx == 0 or amount_idx >= len(tokens) - 1:
                raise ValueError('Simple manual format should look like: Coffee 4.50 Food')
            item = ' '.join(tokens[:amount_idx]).strip()
            amount_text = tokens[amount_idx]
            category = tokens[amount_idx + 1]
            remainder = tokens[amount_idx + 2:]
            entry_date = today_iso()
            remarks = ''
            if remainder:
                if len(remainder[0]) == 10 and remainder[0][4] == '-' and remainder[0][7] == '-':
                    entry_date = remainder[0]
                    remarks = ' '.join(remainder[1:]).strip()
                else:
                    remarks = ' '.join(remainder).strip()
        if not item:
            raise ValueError('Manual entry item cannot be empty.')
        try:
            amount = float(str(amount_text).replace(',', '').strip())
        except ValueError as exc:
            raise ValueError(f'Invalid amount for manual entry: {amount_text}') from exc
        rows.append({
            'item': item,
            'amount': amount,
            'category': category,
            'date': entry_date,
            'remarks': remarks,
        })
    if not rows:
        raise ValueError('No manual entries found.')
    return rows


async def send_typing_action(update_target):
    if hasattr(update_target, 'chat') and hasattr(update_target.chat, 'send_action'):
        await update_target.chat.send_action(ChatAction.TYPING)
        return
    if hasattr(update_target, 'message') and hasattr(update_target.message, 'chat') and hasattr(update_target.message.chat, 'send_action'):
        await update_target.message.chat.send_action(ChatAction.TYPING)
        return


async def typing_heartbeat(update_target, stop_event: asyncio.Event, interval: float = 4.0):
    while not stop_event.is_set():
        try:
            await send_typing_action(update_target)
        except Exception:
            LOG.exception('Failed to send typing action')
            return
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def run_with_typing(update_target, coro):
    stop_event = asyncio.Event()
    task = asyncio.create_task(typing_heartbeat(update_target, stop_event))
    try:
        return await coro
    finally:
        stop_event.set()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def render_preview_text(target_label: str, rows):
    lines = [f'Detected owner/database: {target_label}', '', 'I parsed the following rows:']
    for i, row in enumerate(rows, start=1):
        name = row.get('item', row.get('name', ''))
        amt = row.get('amount')
        cat = row.get('category', '(guess)')
        date = row.get('date', '')
        remarks = row.get('remarks', '')
        sign_hint = ' (income/refund offset)' if isinstance(amt, (int, float)) and amt < 0 else ''
        lines.append(f'{i}. {name} — {amt} — {cat} — {date}{sign_hint}')
        if remarks:
            lines.append(f'   Remarks: {remarks}')
    return '\n'.join(lines)


def preview_markup():
    return InlineKeyboardMarkup([[
        InlineKeyboardButton('Approve', callback_data='approve'),
        InlineKeyboardButton('Edit', callback_data='edit_menu'),
        InlineKeyboardButton('Cancel', callback_data='cancel'),
    ]])


def edit_menu_markup(rows):
    buttons = []
    for i, row in enumerate(rows, start=1):
        name = row.get('item', row.get('name', 'Item'))
        label = f'Edit {i}: {name[:20]}'
        buttons.append([InlineKeyboardButton(label, callback_data=f'edit_item:{i-1}')])
    buttons.append([
        InlineKeyboardButton('Add entry', callback_data='edit_add'),
        InlineKeyboardButton('Remove entry', callback_data='edit_remove'),
    ])
    buttons.append([
        InlineKeyboardButton('Back', callback_data='show_preview'),
        InlineKeyboardButton('Cancel', callback_data='cancel'),
    ])
    return InlineKeyboardMarkup(buttons)


def item_field_markup(item_index):
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton('Name', callback_data=f'edit_field:{item_index}:name'),
            InlineKeyboardButton('Amount', callback_data=f'edit_field:{item_index}:amount'),
        ],
        [
            InlineKeyboardButton('Category', callback_data=f'edit_field:{item_index}:category'),
            InlineKeyboardButton('Date', callback_data=f'edit_field:{item_index}:date'),
        ],
        [InlineKeyboardButton('Remarks', callback_data=f'edit_field:{item_index}:remarks')],
        [
            InlineKeyboardButton('Mark as income/refund', callback_data=f'edit_type:{item_index}:income'),
            InlineKeyboardButton('Mark as expense', callback_data=f'edit_type:{item_index}:expense'),
        ],
        [InlineKeyboardButton('Delete item', callback_data=f'delete_item:{item_index}')],
        [
            InlineKeyboardButton('Back', callback_data='edit_menu'),
            InlineKeyboardButton('Cancel', callback_data='cancel'),
        ],
    ])


def category_choice_markup(item_index, relation_options, has_prev=False, has_next=False):
    buttons = [[InlineKeyboardButton(title, callback_data=f'category_pick:{item_index}:{normalize_key(title)}')] for title in relation_options]
    nav_row = []
    if has_prev:
        nav_row.append(InlineKeyboardButton('⬅️ Prev', callback_data='category_nav:prev'))
    if has_next:
        nav_row.append(InlineKeyboardButton('Next ➡️', callback_data='category_nav:next'))
    if nav_row:
        buttons.append(nav_row)
    buttons.append([
        InlineKeyboardButton('Back', callback_data=f'edit_item:{item_index}'),
        InlineKeyboardButton('Cancel', callback_data='cancel'),
    ])
    return InlineKeyboardMarkup(buttons)


def build_structured_instruction(action, item_index=None, field_name=None, value=None):
    if action == 'field':
        return f'For item {item_index + 1}, set {field_name} to: {value}'
    if action == 'type':
        return f'For item {item_index + 1}, mark transaction type as {field_name}'
    if action == 'delete':
        return f'Remove item {item_index + 1}'
    if action == 'add':
        return f'Add a new expense entry: {value}'
    if action == 'freeform':
        return str(value or '').strip()
    raise ValueError(f'Unknown action: {action}')


def call_hermes_row_editor(rows, instruction: str, edit_target=None):
    target_text = 'not specified' if edit_target is None else str(edit_target)
    prompt = (
        'You are editing parsed expense rows. '
        'Return ONLY a raw JSON array and nothing else. '
        'Preserve fields item, amount, date, category, confidence, remarks, type. '
        'Keep expense amounts positive, but keep income/refund/payback items negative so they offset expenses. '
        'You may modify, remove, or add entries. '
        f'Selected target: {target_text}. '
        f'User instruction: {instruction}\n\n'
        f'Current rows JSON:\n{json.dumps(rows, ensure_ascii=False)}'
    )

    for cmd in ('hermes', 'hermes-cli'):
        try:
            which = subprocess.run(['which', cmd], capture_output=True, text=True, timeout=10)
            if which.returncode != 0 or not which.stdout.strip():
                continue
            proc = subprocess.run(
                [cmd, 'chat', '-Q', '-q', prompt],
                capture_output=True,
                text=True,
                timeout=120,
            )
            stdout = (proc.stdout or '').strip()
            stderr = (proc.stderr or '').strip()
            LOG.info('row editor rc=%s stdout=%r stderr=%r', proc.returncode, stdout[:400], stderr[:400])
            if proc.returncode != 0:
                continue
            new_rows = extract_json_array(stdout)
            if new_rows:
                return new_rows
        except Exception:
            LOG.exception('Hermes row editor failed')
    return []


def clear_edit_state(context, preserve_category_state: bool = False):
    context.user_data.pop('edit_state', None)
    context.user_data.pop('edit_target', None)
    if not preserve_category_state:
        context.user_data.pop('category_prompt', None)
        context.user_data.pop('category_options_map', None)


async def render_category_question(update_target, context):
    rows = context.user_data.get('pending_rows') or []
    category_prompt = context.user_data.get('category_prompt') or {}
    ambiguous = category_prompt.get('ambiguous_items') or []
    option_map = context.user_data.get('category_options_map') or {}
    relation_options = list(option_map.values())
    current_pos = category_prompt.get('current_pos', 0)
    if not ambiguous or not relation_options:
        await show_preview_or_ask_category(update_target, context, rows)
        return
    current_pos = max(0, min(current_pos, len(ambiguous) - 1))
    category_prompt['current_pos'] = current_pos
    current = ambiguous[current_pos]
    idx = current['index']
    category_prompt['raw_category'] = current.get('raw_category')
    category_prompt['item_index'] = idx
    clear_edit_state(context, preserve_category_state=True)
    context.user_data['edit_state'] = {'mode': 'category_clarify', 'item_index': idx, 'field': 'category'}
    context.user_data['category_prompt'] = category_prompt
    text = build_category_clarification_text(rows, ambiguous, current_pos=current_pos)
    markup = category_choice_markup(
        idx,
        relation_options,
        has_prev=current_pos > 0,
        has_next=current_pos < len(ambiguous) - 1,
    )
    if hasattr(update_target, 'edit_message_text'):
        await update_target.edit_message_text(text, reply_markup=markup)
    else:
        await update_target.reply_text(text, reply_markup=markup)


async def show_preview_or_ask_category(update_target, context, rows):
    target_db = context.user_data.get('target_db')
    target_label = context.user_data.get('target_label', 'Unknown')
    relation_options = fetch_relation_options(target_db)
    signed_rows = normalize_signed_rows(rows)
    normalized_rows = normalize_rows_categories(signed_rows, relation_options) if relation_options else list(signed_rows)
    context.user_data['pending_rows'] = normalized_rows
    ambiguous = find_ambiguous_categories(normalized_rows, relation_options) if relation_options else []

    if ambiguous:
        first = ambiguous[0]
        idx = first['index']
        clear_edit_state(context)
        option_map = {normalize_key(title): title for title in relation_options}
        context.user_data['category_options_map'] = option_map
        context.user_data['category_prompt'] = {
            'raw_category': first['raw_category'],
            'item_index': idx,
            'ambiguous_items': ambiguous,
            'current_pos': 0,
        }
        await render_category_question(update_target, context)
        return

    clear_edit_state(context)
    text = render_preview_text(target_label, normalized_rows)
    if hasattr(update_target, 'edit_message_text'):
        await update_target.edit_message_text(text, reply_markup=preview_markup())
    else:
        await update_target.reply_text(text, reply_markup=preview_markup())


async def apply_instruction_and_continue(update_target, context, instruction, edit_target=None):
    rows = context.user_data.get('pending_rows') or []
    target_label = context.user_data.get('target_label', 'Unknown')
    if hasattr(update_target, 'reply_text'):
        await update_target.reply_text('Okay — updating the parsed rows...')
    new_rows = call_hermes_row_editor(rows, instruction, edit_target=edit_target)
    if not new_rows:
        message = (
            'I could not apply that edit. Try something like:\n'
            '- change item 2 category to Food\n'
            '- remove item 3\n'
            '- add Coffee 4.50 Food 2026-05-04\n'
            '- set item 1 remarks to: reimbursable'
        )
        if hasattr(update_target, 'edit_message_text'):
            await update_target.edit_message_text(message)
        else:
            await update_target.reply_text(message)
        return

    context.user_data['pending_rows'] = new_rows
    clear_edit_state(context)
    await show_preview_or_ask_category(update_target, context, new_rows)
    LOG.info('Updated parsed rows for %s', target_label)


async def apply_direct_category_choice(update_target, context, item_index: int, choice: str, raw_category: str | None = None):
    rows = context.user_data.get('pending_rows') or []
    if item_index < 0 or item_index >= len(rows):
        if hasattr(update_target, 'edit_message_text'):
            await update_target.edit_message_text('That item no longer exists. Please reopen the edit menu.')
        else:
            await update_target.reply_text('That item no longer exists. Please reopen the edit menu.')
        return

    updated_rows = list(rows)
    updated_row = dict(updated_rows[item_index])
    updated_row['category'] = choice
    updated_rows[item_index] = updated_row
    context.user_data['pending_rows'] = updated_rows

    learned_source = raw_category or updated_row.get('category')
    if learned_source:
        remember_category_mapping(learned_source, choice)

    clear_edit_state(context)
    await show_preview_or_ask_category(update_target, context, updated_rows)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.message.from_user
    target_db, target_label = target_info_for_user(user.id)
    context.user_data['target_db'] = target_db
    context.user_data['target_label'] = target_label
    await update.message.reply_text(start_message(target_label))


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(help_message())


async def manual_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    user = msg.from_user
    if user.id not in ALLOWED_IDS:
        await msg.reply_text('Sorry — you are not allowed to use this bot.')
        return
    target_db, target_label = target_info_for_user(user.id)
    context.user_data['target_db'] = target_db
    context.user_data['target_label'] = target_label
    clear_edit_state(context)
    context.user_data.pop('pending_rows', None)
    context.user_data['edit_state'] = {'mode': 'manual_add'}
    await msg.reply_text(manual_prompt_message(target_label))


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop('pending_rows', None)
    clear_edit_state(context)
    await update.message.reply_text('Cancelled — no rows written.')


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    user = msg.from_user
    LOG.info('Received media from %s (%s)', user.full_name, user.id)

    if user.id not in ALLOWED_IDS:
        await msg.reply_text('Sorry — you are not allowed to use this bot.')
        LOG.warning('Blocked user %s', user.id)
        return

    target_db, target_label = target_info_for_user(user.id)
    context.user_data['target_db'] = target_db
    context.user_data['target_label'] = target_label
    clear_edit_state(context)

    file = await msg.photo[-1].get_file()
    tmp_path = Path('/tmp') / f'tg_{user.id}_{file.file_id}.jpg'
    await file.download_to_drive(custom_path=str(tmp_path))
    await msg.reply_text(f'Hello, {target_label}! 👋😊 Give me a second to read your transactions...')

    rows = []
    try:
        def process_photo():
            return subprocess.run(
                [sys.executable, str(PROCESS_IMAGE_SCRIPT), str(tmp_path)],
                capture_output=True,
                text=True,
                timeout=int(os.getenv('EXPENSE_BOT_PROCESS_TIMEOUT', '300')),
            )

        proc = await run_with_typing(msg, asyncio.to_thread(process_photo))
        if proc.returncode == 0 and proc.stdout:
            try:
                rows = json.loads(proc.stdout)
            except Exception:
                LOG.error('process_image produced non-JSON stdout: %s', proc.stdout[:400])
                rows = []
        else:
            LOG.error('process_image failed: rc=%s stderr=%s', proc.returncode, (proc.stderr or '')[:400])
            rows = []
    except Exception as e:
        LOG.exception('Error running vision parser: %s', e)
        rows = []

    if not rows:
        await msg.reply_text(
            'Parsing failed or produced no rows. Please try again. '
            'Admin logs: logs/call_vision_analyze.log and logs/process_image.log'
        )
        return

    await show_preview_or_ask_category(msg, context, rows)


async def handle_text_instruction(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    user = msg.from_user
    if user.id not in ALLOWED_IDS:
        await msg.reply_text('Sorry — you are not allowed to use this bot.')
        return

    rows = context.user_data.get('pending_rows')
    edit_state = context.user_data.get('edit_state') or {}
    if not rows and edit_state.get('mode') != 'manual_add':
        await msg.reply_text('Please send a photo/screenshot of a transaction, or use /manual to log entries yourself.')
        return

    instruction = (msg.text or '').strip()
    if not instruction:
        await msg.reply_text('Please send an edit instruction, or use the buttons.')
        return

    edit_state = context.user_data.get('edit_state') or {}
    category_prompt = context.user_data.get('category_prompt') or {}
    option_map = context.user_data.get('category_options_map') or {}

    if edit_state.get('mode') == 'manual_add':
        try:
            manual_rows = parse_manual_entries(instruction)
        except ValueError as exc:
            await msg.reply_text(f'{exc}\n\nFormat: item | amount | category | date | remarks')
            return
        target_db, target_label = target_info_for_user(user.id)
        context.user_data['target_db'] = target_db
        context.user_data['target_label'] = target_label
        context.user_data['pending_rows'] = manual_rows
        clear_edit_state(context)
        await show_preview_or_ask_category(msg, context, manual_rows)
        return

    if edit_state.get('mode') == 'field':
        if edit_state.get('field') == 'category':
            choice = option_map.get(normalize_key(instruction))
            if not choice:
                candidates = list(option_map.values())
                close = difflib.get_close_matches(instruction, candidates, n=1, cutoff=0.6)
                choice = close[0] if close else None
            if not choice:
                await msg.reply_text('I could not match that to a current category. Please tap a button or type one of the exact category names.')
                return
            await apply_direct_category_choice(
                msg,
                context,
                edit_state['item_index'],
                choice,
                raw_category=None,
            )
            return
        # Fast local path: handle amount edits locally to avoid depending on the LLM/CLI editor.
        # This fixes failures when the hermes row editor is unavailable or times out.
        field_name = edit_state.get('field')
        if field_name == 'amount':
            try:
                from penny_pal_bot.expense_signs import parse_amount
                rows = context.user_data.get('pending_rows') or []
                idx = edit_state['item_index']
                if idx < 0 or idx >= len(rows):
                    await msg.reply_text('That item no longer exists. Please reopen the edit menu.')
                    return
                parsed = parse_amount(instruction)
                if parsed is None:
                    await msg.reply_text('Could not parse that amount. Try a numeric value like 39.05 or 39')
                    return
                updated_rows = list(rows)
                updated_row = dict(updated_rows[idx])
                updated_row['amount'] = parsed
                updated_rows[idx] = updated_row
                context.user_data['pending_rows'] = updated_rows
                clear_edit_state(context)
                await show_preview_or_ask_category(msg, context, updated_rows)
                return
            except Exception:
                LOG.exception('Failed to apply direct amount edit')
                # fall back to LLM-based editor below
        built = build_structured_instruction('field', edit_state['item_index'], edit_state['field'], instruction)
        await apply_instruction_and_continue(msg, context, built, edit_target=edit_state['item_index'])
        return

    if edit_state.get('mode') == 'add':
        built = build_structured_instruction('add', value=instruction)
        await apply_instruction_and_continue(msg, context, built, edit_target='add')
        return

    if edit_state.get('mode') == 'remove':
        built = build_structured_instruction('freeform', value=instruction)
        await apply_instruction_and_continue(msg, context, built, edit_target='remove')
        return

    if edit_state.get('mode') == 'category_clarify':
        choice = option_map.get(normalize_key(instruction))
        if not choice:
            candidates = list(option_map.values())
            close = difflib.get_close_matches(instruction, candidates, n=1, cutoff=0.6)
            choice = close[0] if close else None
        if not choice:
            await msg.reply_text('I could not match that to a current category. Please tap a button or type one of the exact category names.')
            return
        await apply_direct_category_choice(
            msg,
            context,
            edit_state['item_index'],
            choice,
            raw_category=category_prompt.get('raw_category'),
        )
        return

    await apply_instruction_and_continue(msg, context, build_structured_instruction('freeform', value=instruction))


async def button_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == 'cancel':
        context.user_data.pop('pending_rows', None)
        clear_edit_state(context)
        await query.edit_message_text('Cancelled — no rows written.')
        return

    if data == 'show_preview':
        rows = context.user_data.get('pending_rows') or []
        await show_preview_or_ask_category(query, context, rows)
        return

    if data == 'edit_menu':
        rows = context.user_data.get('pending_rows') or []
        target_label = context.user_data.get('target_label', 'Unknown')
        clear_edit_state(context)
        text = (
            f'Editing {target_label} entries. Choose an item below, or send a text instruction.\n\n'
            'Examples:\n'
            '- change item 2 category to Food\n'
            '- remove item 3\n'
            '- add Coffee 4.50 Food 2026-05-04\n'
            '- set item 1 remarks to: reimbursable'
        )
        await query.edit_message_text(text, reply_markup=edit_menu_markup(rows))
        return

    if data.startswith('edit_item:'):
        idx = int(data.split(':', 1)[1])
        rows = context.user_data.get('pending_rows') or []
        item_name = rows[idx].get('item', rows[idx].get('name', f'item {idx + 1}')) if idx < len(rows) else f'item {idx + 1}'
        clear_edit_state(context)
        await query.edit_message_text(
            f'Choose what to edit for item {idx + 1} ({item_name}).',
            reply_markup=item_field_markup(idx),
        )
        return

    if data.startswith('edit_field:'):
        _, idx_text, field_name = data.split(':', 2)
        idx = int(idx_text)
        rows = context.user_data.get('pending_rows') or []
        row = rows[idx] if idx < len(rows) else {}
        if field_name == 'category':
            relation_options = fetch_relation_options(context.user_data.get('target_db'))
            clear_edit_state(context)
            context.user_data['edit_state'] = {'mode': 'field', 'item_index': idx, 'field': 'category'}
            context.user_data['category_options_map'] = {normalize_key(title): title for title in relation_options}
            await query.edit_message_text(
                f"Choose the category for item {idx + 1}, or type one in chat. Current value: {row.get('category', '')}",
                reply_markup=category_choice_markup(idx, relation_options),
            )
            return
        context.user_data['edit_state'] = {'mode': 'field', 'item_index': idx, 'field': field_name}
        current_value = row.get(field_name, row.get('item' if field_name == 'name' else field_name, ''))
        prompt_name = 'name' if field_name == 'name' else field_name
        await query.edit_message_text(
            f'Send the new {prompt_name} for item {idx + 1}. Current value: {current_value}'
        )
        return

    if data.startswith('edit_type:'):
        _, idx_text, transaction_type = data.split(':', 2)
        idx = int(idx_text)
        rows = context.user_data.get('pending_rows') or []
        if idx >= len(rows):
            await query.edit_message_text('That item no longer exists. Please reopen the edit menu.')
            return
        updated_rows = list(rows)
        updated_row = dict(updated_rows[idx])
        updated_row['type'] = transaction_type
        updated_rows[idx] = updated_row
        context.user_data['pending_rows'] = updated_rows
        await show_preview_or_ask_category(query, context, updated_rows)
        return

    if data.startswith('delete_item:'):
        idx = int(data.split(':', 1)[1])
        built = build_structured_instruction('delete', item_index=idx)
        await apply_instruction_and_continue(query, context, built, edit_target=idx)
        return

    if data == 'edit_add':
        context.user_data['edit_state'] = {'mode': 'add'}
        await query.edit_message_text(
            'Send me the new entry to add.\n'
            'Example: add Coffee 4.50 Food 2026-05-04\n'
            'You can also include remarks, e.g. Coffee 4.50 Food 2026-05-04 remarks reimbursable'
        )
        return

    if data == 'edit_remove':
        context.user_data['edit_state'] = {'mode': 'remove'}
        await query.edit_message_text(
            'Tell me which entry to remove.\n'
            'Example: remove item 3'
        )
        return

    if data.startswith('category_pick:'):
        _, idx_text, normalized = data.split(':', 2)
        idx = int(idx_text)
        option_map = context.user_data.get('category_options_map') or {}
        choice = option_map.get(normalized)
        rows = context.user_data.get('pending_rows') or []
        if not choice:
            await query.edit_message_text('That category option is no longer available. Please reopen the edit menu.')
            return
        raw_category = None
        category_prompt = context.user_data.get('category_prompt') or {}
        ambiguous = category_prompt.get('ambiguous_items') or []
        current_pos = category_prompt.get('current_pos', 0)
        if current_pos < len(ambiguous):
            raw_category = ambiguous[current_pos].get('raw_category')
        elif category_prompt.get('item_index') == idx:
            raw_category = category_prompt.get('raw_category')
        elif idx < len(rows):
            raw_category = rows[idx].get('category')
        await apply_direct_category_choice(
            query,
            context,
            idx,
            choice,
            raw_category=raw_category,
        )
        return

    if data in {'category_nav:prev', 'category_nav:next'}:
        category_prompt = context.user_data.get('category_prompt') or {}
        ambiguous = category_prompt.get('ambiguous_items') or []
        if not ambiguous:
            await show_preview_or_ask_category(query, context, context.user_data.get('pending_rows') or [])
            return
        current_pos = category_prompt.get('current_pos', 0)
        current_pos = max(0, current_pos - 1) if data.endswith('prev') else min(len(ambiguous) - 1, current_pos + 1)
        current = ambiguous[current_pos]
        category_prompt['current_pos'] = current_pos
        category_prompt['raw_category'] = current.get('raw_category')
        category_prompt['item_index'] = current.get('index')
        context.user_data['category_prompt'] = category_prompt
        await render_category_question(query, context)
        return

    if data == 'approve':
        rows = context.user_data.get('pending_rows')
        if not rows:
            await query.edit_message_text('No pending rows found — nothing to submit.')
            return

        target_db = context.user_data.get('target_db')
        relation_options = fetch_relation_options(target_db)
        ambiguous = find_ambiguous_categories(rows, relation_options) if relation_options else []
        if ambiguous:
            await show_preview_or_ask_category(query, context, rows)
            return

        user = query.from_user
        _, target_label = target_info_for_user(user.id)
        if not SUBMIT_SCRIPT.exists():
            await query.edit_message_text('Submit script not found on the agent. Ask admin to install submit_rows.py')
            return

        try:
            def submit_rows_work():
                return subprocess.run(
                    [sys.executable, str(SUBMIT_SCRIPT), target_db],
                    input=json.dumps(rows),
                    text=True,
                    capture_output=True,
                    timeout=60,
                    env=dict(os.environ),
                )

            await query.edit_message_text(approve_in_progress_message(target_label))
            proc = await run_with_typing(query, asyncio.to_thread(submit_rows_work))
        except Exception as e:
            await query.edit_message_text(f'Error submitting to {target_label}: {e}')
            return

        if proc.returncode != 0:
            await query.edit_message_text(f'Submit failed for {target_label}: {(proc.stderr or "")[:400]}')
            return

        context.user_data.pop('pending_rows', None)
        clear_edit_state(context)
        await query.edit_message_text(success_message(target_label))
        return


async def fallback_unknown(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text('Please send a photo/screenshot of a transaction, use /manual to log entries yourself, or use /help to see commands.')


def main():
    if not TELEGRAM_TOKEN:
        LOG.error('TELEGRAM_TOKEN is required in environment')
        sys.exit(1)
    if not NOTION_TOKEN:
        LOG.error('NOTION_TOKEN is required in environment')
        sys.exit(1)
    if not DEFAULT_DB:
        LOG.error('EXPENSE_BOT_DEFAULT_DB_ID is required in environment')
        sys.exit(1)
    if not ALLOWED_IDS:
        LOG.error('EXPENSE_BOT_ALLOWED_USER_IDS must include at least one Telegram user ID')
        sys.exit(1)
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('help', help_command))
    app.add_handler(CommandHandler('manual', manual_command))
    app.add_handler(CommandHandler('cancel', cancel_command))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(CallbackQueryHandler(button_cb))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_instruction))
    app.add_handler(MessageHandler(filters.ALL, fallback_unknown))
    LOG.info('Starting Telegram bot — listening for images (strict allowlist)')
    app.run_polling()


if __name__ == '__main__':
    main()
