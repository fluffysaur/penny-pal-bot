#!/usr/bin/env python3
"""Shared category normalization, learning, and clarification helpers."""

import difflib
import json
import logging
from pathlib import Path
from typing import Iterable

LOG = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parents[1]
STATE_DIR = BASE_DIR / 'state'
STATE_DIR.mkdir(parents=True, exist_ok=True)
CATEGORY_MEMORY_FILE = STATE_DIR / 'category_learning.json'

CATEGORY_ALIASES = {
    'transport': 'Transport',
    'bus': 'Transport',
    'mrt': 'Transport',
    'grab': 'Transport',
    'taxi': 'Transport',
    'train': 'Transport',
    'food': 'Food',
    'grocer': 'Food',
    'shopping': 'Lifestyle',
    'lifestyle': 'Lifestyle',
    'software': 'Lifestyle',
    'subscription': 'Lifestyle',
    'invest': 'Investments',
    'goal': 'Goals',
    'saving': 'Savings',
    'tith': 'Tithing',
    'buffer': 'Buffer',
}

MISSING_CATEGORY_LABELS = {
    '',
    'none',
    'null',
    'nil',
    'n/a',
    'na',
    'unknown',
    'uncategorized',
    'uncategorised',
    'missing',
    'notset',
    'notspecified',
}
MISSING_CATEGORY_KEYS = {''.join(ch for ch in label.lower() if ch.isalnum()) for label in MISSING_CATEGORY_LABELS}


def normalize_key(value):
    return ''.join(ch for ch in str(value or '').lower() if ch.isalnum())


def category_needs_clarification(raw_category) -> bool:
    if raw_category is None:
        return True
    raw = str(raw_category).strip()
    if not raw:
        return True
    return normalize_key(raw) in MISSING_CATEGORY_KEYS


def load_learned_category_map():
    try:
        if CATEGORY_MEMORY_FILE.exists():
            data = json.loads(CATEGORY_MEMORY_FILE.read_text())
            if isinstance(data, dict):
                return data
    except Exception:
        LOG.exception('Failed to load learned category map')
    return {}


def save_learned_category_map(data):
    CATEGORY_MEMORY_FILE.write_text(json.dumps(data, indent=2, sort_keys=True))


def remember_category_mapping(raw_category: str, selected_category: str):
    learned = load_learned_category_map()
    learned[normalize_key(raw_category)] = selected_category
    save_learned_category_map(learned)


def resolve_category_name(raw_category, relation_options, learned_map=None):
    if not raw_category:
        return None
    learned_map = learned_map or {}
    raw = str(raw_category).strip()
    raw_norm = normalize_key(raw)
    raw_lower = raw.lower()
    option_lookup = {normalize_key(title): title for title in relation_options}

    if raw_norm in option_lookup:
        return option_lookup[raw_norm]

    learned_value = learned_map.get(raw_norm)
    if learned_value and normalize_key(learned_value) in option_lookup:
        return option_lookup[normalize_key(learned_value)]

    for needle, canonical in CATEGORY_ALIASES.items():
        if needle in raw_lower and normalize_key(canonical) in option_lookup:
            return option_lookup[normalize_key(canonical)]

    for title in relation_options:
        title_lower = title.lower()
        if raw_lower in title_lower or title_lower in raw_lower:
            return title

    close = difflib.get_close_matches(raw_norm, list(option_lookup.keys()), n=1, cutoff=0.72)
    if close:
        return option_lookup[close[0]]

    return None


def normalize_rows_categories(rows, relation_options, learned_map=None):
    learned_map = learned_map or load_learned_category_map()
    normalized_rows = []
    for row in rows:
        new_row = dict(row)
        raw_category = new_row.get('category')
        resolved = resolve_category_name(raw_category, relation_options, learned_map=learned_map)
        if raw_category and resolved:
            new_row['category'] = resolved
        normalized_rows.append(new_row)
    return normalized_rows


def find_ambiguous_categories(rows, known):
    if isinstance(known, dict):
        relation_options = list({value for value in known.values()})
        learned_map = dict(known)
    else:
        relation_options = list(known)
        learned_map = load_learned_category_map()

    ambiguous = []
    for idx, row in enumerate(rows):
        raw_category = row.get('category')
        if category_needs_clarification(raw_category):
            display_value = str(raw_category).strip() if raw_category is not None and str(raw_category).strip() else '(missing category)'
            ambiguous.append({'index': idx, 'raw_category': display_value})
            continue
        resolved = resolve_category_name(raw_category, relation_options, learned_map=learned_map)
        if raw_category and not resolved:
            ambiguous.append({'index': idx, 'raw_category': raw_category})
    return ambiguous


def build_category_clarification_text(rows, ambiguous, current_pos=0):
    current_pos = max(0, min(current_pos, len(ambiguous) - 1)) if ambiguous else 0
    lines = [
        'I need your help with a few categories before I show the final list:',
        f'Question {current_pos + 1} of {len(ambiguous)}',
        '',
    ]
    for item in ambiguous:
        idx = item['index']
        raw_category = item['raw_category']
        row = rows[idx] if idx < len(rows) else {}
        name = row.get('item', row.get('name', f'item {idx + 1}'))
        lines.append(f'{idx + 1}. {name} — detected label: {raw_category} (not in allowed categories)')
    lines.extend([
        '',
        f"Let's fix them one by one, currently on item {ambiguous[current_pos]['index'] + 1}.",
        'Choose the correct category from your allowed categories below, or type one in text. I will remember it for next time.',
    ])
    return '\n'.join(lines)
