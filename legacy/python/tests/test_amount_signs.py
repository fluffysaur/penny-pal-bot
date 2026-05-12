from pathlib import Path
import importlib.util

MODULE_PATH = Path(__file__).resolve().parents[1] / 'penny_pal_bot' / 'expense_signs.py'


def load_module():
    spec = importlib.util.spec_from_file_location('expense_signs_under_test', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_expense_amount_stays_positive():
    mod = load_module()
    assert mod.normalize_row_amount({'item': 'Coffee', 'amount': '4.50', 'category': 'Food'})['amount'] == 4.5


def test_refund_keywords_flip_amount_negative():
    mod = load_module()
    assert mod.normalize_row_amount({'item': 'Shopee refund', 'amount': '12.34', 'category': 'Lifestyle'})['amount'] == -12.34


def test_payback_keywords_flip_amount_negative():
    mod = load_module()
    row = {'item': 'Dinner payback from Rachel', 'amount': '20.00', 'remarks': 'friends paid me back'}
    assert mod.normalize_row_amount(row)['amount'] == -20.0


def test_existing_negative_amount_stays_negative():
    mod = load_module()
    assert mod.normalize_row_amount({'item': 'Refund', 'amount': '-8.80'})['amount'] == -8.8


def test_normalize_rows_applies_signing_to_each_row():
    mod = load_module()
    rows = [{'item': 'Lunch', 'amount': '10.00'}, {'item': 'Grab refund', 'amount': '3.20'}]
    normalized = mod.normalize_rows(rows)
    assert normalized[0]['amount'] == 10.0
    assert normalized[1]['amount'] == -3.2


def test_manual_income_type_forces_negative_even_without_keywords():
    mod = load_module()
    assert mod.normalize_row_amount({'item': 'Dinner split', 'amount': '15.00', 'type': 'income'})['amount'] == -15.0


def test_manual_expense_type_forces_positive_even_with_refund_keyword():
    mod = load_module()
    assert mod.normalize_row_amount({'item': 'Refundable deposit', 'amount': '15.00', 'type': 'expense'})['amount'] == 15.0
