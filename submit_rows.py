#!/usr/bin/env python3
"""Submit parsed rows JSON (stdin) to Notion."""

import difflib
import json
import os
import re
import sys
from datetime import date, datetime

import requests

from penny_pal_bot.expense_signs import normalize_rows as normalize_signed_rows, parse_amount

NOTION_TOKEN = os.getenv('NOTION_TOKEN')
if not NOTION_TOKEN:
    print('NOTION_TOKEN missing', file=sys.stderr)
    sys.exit(2)

if len(sys.argv) < 2:
    print('Usage: submit_rows.py <target_db_id>', file=sys.stderr)
    sys.exit(2)

target_db = sys.argv[1]
rows = json.load(sys.stdin)

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
}
BASE_URL = 'https://api.notion.com/v1'


def normalize_text(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def normalize_date(value):
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    m = re.match(r'^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$', s)
    if m:
        return m.group(1)

    today = date.today()
    formats = [
        '%d %b %Y', '%d %B %Y', '%d %b', '%d %B',
        '%b %d %Y', '%B %d %Y', '%b %d', '%B %d',
        '%d/%m/%Y', '%d/%m/%y', '%d/%m', '%d-%m-%Y', '%d-%m-%y', '%d-%m',
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(s, fmt)
            if '%Y' not in fmt and '%y' not in fmt:
                dt = dt.replace(year=today.year)
                if dt.date() > today and (dt.date() - today).days > 30:
                    dt = dt.replace(year=today.year - 1)
            return dt.date().isoformat()
        except ValueError:
            pass
    return None


def notion_get(path):
    resp = requests.get(f'{BASE_URL}{path}', headers=headers, timeout=30)
    if resp.status_code != 200:
        print('Notion GET failed', resp.status_code, resp.text, file=sys.stderr)
        sys.exit(3)
    return resp.json()


def notion_post(path, payload):
    return requests.post(f'{BASE_URL}{path}', headers=headers, json=payload, timeout=30)


def get_database_schema(db_id):
    return notion_get(f'/databases/{db_id}')


def query_database(db_id):
    results = []
    payload = {'page_size': 100}
    while True:
        resp = notion_post(f'/databases/{db_id}/query', payload)
        if resp.status_code != 200:
            print('Notion query failed', resp.status_code, resp.text, file=sys.stderr)
            sys.exit(3)
        data = resp.json()
        results.extend(data.get('results', []))
        if not data.get('has_more'):
            break
        payload['start_cursor'] = data.get('next_cursor')
    return results


def get_property_names(schema):
    props = schema.get('properties', {})
    found = {'title': None, 'amount': None, 'date': None, 'category': None, 'remarks': None}
    for name, prop in props.items():
        prop_type = prop.get('type')
        lowered = name.lower()
        if prop_type == 'title' and (found['title'] is None or lowered == 'item'):
            found['title'] = name
        elif prop_type == 'number' and (found['amount'] is None or lowered == 'amount'):
            found['amount'] = name
        elif prop_type == 'date' and (found['date'] is None or lowered == 'date'):
            found['date'] = name
        elif prop_type == 'relation' and (found['category'] is None or lowered == 'category'):
            found['category'] = name
        elif prop_type == 'rich_text' and (found['remarks'] is None or lowered == 'remarks'):
            found['remarks'] = name
    return found


def extract_title_from_page(page):
    props = page.get('properties', {})
    for prop in props.values():
        if prop.get('type') == 'title':
            parts = []
            for chunk in prop.get('title', []):
                parts.append(chunk.get('plain_text') or chunk.get('text', {}).get('content', ''))
            return ''.join(parts).strip()
    return ''


def get_relation_options(schema, prop_names):
    category_prop = prop_names.get('category')
    if not category_prop:
        return []
    relation_info = schema.get('properties', {}).get(category_prop, {}).get('relation', {})
    relation_db_id = relation_info.get('database_id')
    if not relation_db_id:
        return []
    pages = query_database(relation_db_id)
    options = []
    for page in pages:
        title = extract_title_from_page(page)
        if title:
            options.append({'id': page.get('id'), 'title': title})
    return options


def resolve_relation_id(raw_category, relation_options):
    if not raw_category or not relation_options:
        return None
    raw = str(raw_category).strip()
    raw_lower = raw.lower()
    normalized_title_map = {normalize_text(opt['title']): opt['id'] for opt in relation_options}
    aliases = [
        ('transport', 'Transport'), ('bus', 'Transport'), ('mrt', 'Transport'), ('grab', 'Transport'),
        ('taxi', 'Transport'), ('train', 'Transport'), ('food', 'Food'), ('grocer', 'Food'),
        ('shopping', 'Lifestyle'), ('lifestyle', 'Lifestyle'), ('software', 'Lifestyle'),
        ('subscription', 'Lifestyle'), ('invest', 'Investments'), ('goal', 'Goals'),
        ('saving', 'Savings'), ('tith', 'Tithing'), ('buffer', 'Buffer'),
    ]
    for needle, canonical in aliases:
        if needle in raw_lower:
            match_id = normalized_title_map.get(normalize_text(canonical))
            if match_id:
                return match_id
    raw_norm = normalize_text(raw)
    if raw_norm in normalized_title_map:
        return normalized_title_map[raw_norm]
    for opt in relation_options:
        opt_lower = opt['title'].lower()
        if raw_lower in opt_lower or opt_lower in raw_lower:
            return opt['id']
    close = difflib.get_close_matches(raw_norm, list(normalized_title_map.keys()), n=1, cutoff=0.55)
    if close:
        return normalized_title_map[close[0]]
    return None


def main():
    schema = get_database_schema(target_db)
    prop_names = get_property_names(schema)
    relation_options = get_relation_options(schema, prop_names)
    if not prop_names.get('title'):
        print('Could not find title property in target database schema', file=sys.stderr)
        sys.exit(3)

    signed_rows = normalize_signed_rows(rows)
    for row in signed_rows:
        props = {}
        item = row.get('item') or row.get('name') or 'Unknown'
        amt = row.get('amount')
        raw_date = row.get('date')
        cat = row.get('category')
        num = parse_amount(amt)
        props[prop_names['title']] = {'title': [{'text': {'content': str(item)}}]}
        if num is not None and prop_names.get('amount'):
            props[prop_names['amount']] = {'number': num}
        iso_date = normalize_date(raw_date)
        if iso_date and prop_names.get('date'):
            props[prop_names['date']] = {'date': {'start': iso_date}}
        elif raw_date:
            print(f'Invalid date after normalization: {raw_date!r}', file=sys.stderr)
            sys.exit(3)
        rel_id = resolve_relation_id(cat, relation_options)
        if rel_id and prop_names.get('category'):
            props[prop_names['category']] = {'relation': [{'id': rel_id}]}

        remarks = []
        if row.get('remarks'):
            remarks.append(str(row['remarks']))
        if row.get('type') == 'income':
            remarks.append('Transaction marked as income/refund offset')
        if remarks and prop_names.get('remarks'):
            props[prop_names['remarks']] = {'rich_text': [{'text': {'content': '; '.join(remarks)[:1900]}}]}

        resp = notion_post('/pages', {'parent': {'database_id': target_db}, 'properties': props})
        if resp.status_code != 200:
            print('Create page failed', resp.status_code, resp.text, file=sys.stderr)
            sys.exit(3)

    print(json.dumps({'ok': True, 'count': len(signed_rows)}))


if __name__ == '__main__':
    main()
