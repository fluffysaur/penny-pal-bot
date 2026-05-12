#!/usr/bin/env python3
"""Shared amount-sign normalization for expense rows."""

from __future__ import annotations

import re
from typing import Iterable

INCOME_KEYWORDS = (
    'refund',
    'refunded',
    'reversal',
    'reversed',
    'cashback',
    'rebate',
    'returned',
    'return',
    'payback',
    'paid me back',
    'pay me back',
    'reimburs',
    'reimbursement',
    'income',
    'credit back',
    'credited back',
    'received from',
)


def _combined_text(row: dict) -> str:
    parts = [
        row.get('item'),
        row.get('name'),
        row.get('category'),
        row.get('remarks'),
        row.get('note'),
        row.get('description'),
        row.get('type'),
    ]
    return ' '.join(str(part) for part in parts if part).lower()


def row_looks_like_income(row: dict) -> bool:
    row_type = str(row.get('type') or '').strip().lower()
    if row_type == 'income':
        return True
    if row_type == 'expense':
        return False
    combined = _combined_text(row)
    return any(keyword in combined for keyword in INCOME_KEYWORDS)


_AMOUNT_CLEAN_RE = re.compile(r'[^0-9.\-]+')


def parse_amount(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    cleaned = _AMOUNT_CLEAN_RE.sub('', text.replace(',', ''))
    if cleaned in {'', '-', '.', '-.'}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def normalize_row_amount(row: dict) -> dict:
    """Normalize the numeric amount and set its sign consistently.

    Desired convention:
    - Expenses are stored as positive numbers.
    - Income / refunds / reimbursements are stored as negative numbers (so they offset expenses).

    Many bank/card statements use the opposite convention (expenses shown as negative). To avoid sign confusion,
    determine the transaction type (income vs expense) from explicit `type` or keyword heuristics and then
    assign the sign based on that detection regardless of the original parsed sign.
    """
    new_row = dict(row)
    amount = parse_amount(new_row.get('amount'))
    if amount is None:
        return new_row

    is_income = row_looks_like_income(new_row)
    abs_amount = abs(amount)

    # Income/refund -> negative (offset)
    if is_income:
        new_row['amount'] = -abs_amount
    else:
        # Expense or unknown -> positive
        new_row['amount'] = abs_amount
    return new_row


def normalize_rows(rows: Iterable[dict]) -> list[dict]:
    return [normalize_row_amount(row) for row in rows]
