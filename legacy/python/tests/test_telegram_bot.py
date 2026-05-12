import importlib.util
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT_DIR = Path(__file__).resolve().parents[1]
BOT_PATH = ROOT_DIR / 'telegram_bot.py'


def load_bot_module():
    os.environ.setdefault('TELEGRAM_TOKEN', 'test-token')
    os.environ.setdefault('NOTION_TOKEN', 'test-notion-token')
    os.environ.setdefault('EXPENSE_BOT_ALLOWED_USER_IDS', '72171277')
    os.environ.setdefault('EXPENSE_BOT_DEFAULT_DB_ID', 'test-default-db')
    os.environ.setdefault('EXPENSE_BOT_USER_DB_MAP_JSON', '{"72171277":"test-default-db"}')
    os.environ.setdefault('EXPENSE_BOT_DB_LABELS_JSON', '{"test-default-db":"Test User"}')
    helper_path = BOT_PATH.parent / 'penny_pal_bot' / 'category_helpers.py'
    helper_spec = importlib.util.spec_from_file_location('penny_pal_bot.category_helpers', helper_path)
    helper_module = importlib.util.module_from_spec(helper_spec)
    sys.modules['penny_pal_bot.category_helpers'] = helper_module
    helper_spec.loader.exec_module(helper_module)

    signs_path = BOT_PATH.parent / 'penny_pal_bot' / 'expense_signs.py'
    signs_spec = importlib.util.spec_from_file_location('penny_pal_bot.expense_signs', signs_path)
    signs_module = importlib.util.module_from_spec(signs_spec)
    sys.modules['penny_pal_bot.expense_signs'] = signs_module
    signs_spec.loader.exec_module(signs_module)

    spec = importlib.util.spec_from_file_location('penny_pal_bot_under_test', BOT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_item_field_markup_contains_structured_edit_buttons():
    bot = load_bot_module()
    markup = bot.item_field_markup(0)
    labels = [button.text for row in markup.inline_keyboard for button in row]

    assert 'Name' in labels
    assert 'Amount' in labels
    assert 'Category' in labels
    assert 'Date' in labels
    assert 'Remarks' in labels
    assert 'Mark as income/refund' in labels
    assert 'Mark as expense' in labels
    assert 'Delete item' in labels


def test_build_structured_instruction_for_field_edit():
    bot = load_bot_module()
    instruction = bot.build_structured_instruction('field', 1, 'remarks', 'split shared expense with Rachel')
    assert instruction == 'For item 2, set remarks to: split shared expense with Rachel'


def test_build_structured_instruction_for_delete():
    bot = load_bot_module()
    instruction = bot.build_structured_instruction('delete', 2, None, None)
    assert instruction == 'Remove item 3'


def test_build_structured_instruction_for_type_override():
    bot = load_bot_module()
    instruction = bot.build_structured_instruction('type', 0, 'income', None)
    assert instruction == 'For item 1, mark transaction type as income'


def test_render_preview_text_includes_remarks_when_present():
    bot = load_bot_module()
    preview = bot.render_preview_text('Yi Jia', [{
        'item': 'Coffee', 'amount': 4.5, 'category': 'Food', 'date': '2026-05-04', 'remarks': 'team sync'
    }])
    assert 'Remarks: team sync' in preview


def test_find_ambiguous_categories_returns_only_unresolved_rows():
    bot = load_bot_module()
    rows = [
        {'item': 'Coffee', 'category': 'Food'},
        {'item': 'Claude', 'category': 'Software/Subscription'},
        {'item': 'Mystery', 'category': '???'},
    ]
    known = {'food': 'Food', 'softwaresubscription': 'Lifestyle'}
    ambiguous = bot.find_ambiguous_categories(rows, known)
    assert len(ambiguous) == 1
    assert ambiguous[0]['index'] == 2
    assert ambiguous[0]['raw_category'] == '???'


def test_normalize_rows_categories_maps_software_subscription_to_lifestyle():
    bot = load_bot_module()
    normalized = bot.normalize_rows_categories([
        {'item': 'Google Claude', 'category': 'Software/Subscription'}
    ], ['Lifestyle', 'Food'])
    assert normalized[0]['category'] == 'Lifestyle'


def test_exact_allowed_category_is_not_overridden_by_learned_mapping():
    bot = load_bot_module()
    normalized = bot.normalize_rows_categories([
        {'item': 'Shopee', 'category': 'Lifestyle'}
    ], ['Lifestyle', 'Food'], learned_map={'lifestyle': 'Food'})
    assert normalized[0]['category'] == 'Lifestyle'


def test_build_category_clarification_text_lists_all_uncertain_items():
    bot = load_bot_module()
    rows = [
        {'item': 'Mystery A', 'category': '???'},
        {'item': 'Mystery B', 'category': 'Unknown'},
    ]
    ambiguous = [
        {'index': 0, 'raw_category': '???'},
        {'index': 1, 'raw_category': 'Unknown'},
    ]
    text = bot.build_category_clarification_text(rows, ambiguous)
    assert 'before I show the final list' in text
    assert '1. Mystery A — detected label: ??? (not in allowed categories)' in text
    assert '2. Mystery B — detected label: Unknown (not in allowed categories)' in text


def test_render_category_question_preserves_category_option_state():
    import asyncio

    bot = load_bot_module()
    context = SimpleNamespace(user_data={
        'pending_rows': [{'item': 'Claude', 'category': 'Software/Subscription'}],
        'category_prompt': {
            'raw_category': 'Software/Subscription',
            'item_index': 0,
            'ambiguous_items': [{'index': 0, 'raw_category': 'Software/Subscription'}],
            'current_pos': 0,
        },
        'category_options_map': {'lifestyle': 'Lifestyle', 'food': 'Food'},
    })

    class DummyTarget:
        def __init__(self):
            self.calls = []

        async def edit_message_text(self, text, reply_markup=None):
            self.calls.append({'text': text, 'reply_markup': reply_markup})

    target = DummyTarget()
    asyncio.run(bot.render_category_question(target, context))
    assert context.user_data['category_options_map'] == {'lifestyle': 'Lifestyle', 'food': 'Food'}
    assert context.user_data['edit_state']['mode'] == 'category_clarify'
    assert context.user_data['edit_state']['item_index'] == 0
    assert target.calls


def test_success_message_matches_requested_wording():
    bot = load_bot_module()
    assert bot.success_message('Yi Jia') == 'Expenses logged! Thank you, Yi Jia 🤑'


def test_category_choice_markup_includes_navigation_buttons():
    bot = load_bot_module()
    markup = bot.category_choice_markup(1, ['Lifestyle', 'Food'], has_prev=True, has_next=True)
    labels = [button.text for row in markup.inline_keyboard for button in row]
    assert '⬅️ Prev' in labels
    assert 'Next ➡️' in labels


def test_build_category_clarification_text_mentions_position():
    bot = load_bot_module()
    rows = [
        {'item': 'Mystery A', 'category': '???'},
        {'item': 'Mystery B', 'category': 'Unknown'},
    ]
    ambiguous = [
        {'index': 0, 'raw_category': '???'},
        {'index': 1, 'raw_category': 'Unknown'},
    ]
    text = bot.build_category_clarification_text(rows, ambiguous, current_pos=1)
    assert 'Question 2 of 2' in text
    assert "Let's fix them one by one, currently on item 2." in text
    assert 'allowed categories below' in text


def test_render_preview_text_marks_negative_amount_as_offset():
    bot = load_bot_module()
    preview = bot.render_preview_text('Yi Jia', [{
        'item': 'Rachel paid me back', 'amount': -12.5, 'category': 'Food', 'date': '2026-05-04'
    }])
    assert '(income/refund offset)' in preview


def test_apply_direct_category_choice_updates_rows_without_row_editor():
    import asyncio

    bot = load_bot_module()

    async def fake_show_preview_or_ask_category(update_target, context, rows):
        context.user_data['preview_called_with'] = rows

    bot.show_preview_or_ask_category = fake_show_preview_or_ask_category

    remembered = []
    bot.remember_category_mapping = lambda raw, selected: remembered.append((raw, selected))

    context = SimpleNamespace(user_data={
        'pending_rows': [
            {'item': 'Google Claude', 'category': 'Subscription / Software', 'amount': 29.98}
        ],
        'edit_state': {'mode': 'category_clarify', 'item_index': 0, 'field': 'category'},
        'category_prompt': {'raw_category': 'Subscription / Software'},
        'category_options_map': {'lifestyle': 'Lifestyle'},
    })

    class DummyTarget:
        async def edit_message_text(self, text, reply_markup=None):
            raise AssertionError('Should not emit an error message')

        async def reply_text(self, text, reply_markup=None):
            raise AssertionError('Should not emit a chat reply')

    asyncio.run(bot.apply_direct_category_choice(DummyTarget(), context, 0, 'Lifestyle', raw_category='Subscription / Software'))

    assert context.user_data['pending_rows'][0]['category'] == 'Lifestyle'
    assert context.user_data['preview_called_with'][0]['category'] == 'Lifestyle'
    assert remembered == [('Subscription / Software', 'Lifestyle')]


def test_manual_edit_category_does_not_write_learned_mapping():
    bot = load_bot_module()
    calls = []
    bot.remember_category_mapping = lambda raw, selected: calls.append((raw, selected))

    context = SimpleNamespace(user_data={
        'pending_rows': [{'item': 'Shopee', 'category': 'Food'}],
        'edit_state': {'mode': 'field', 'item_index': 0, 'field': 'category'},
        'category_options_map': {'lifestyle': 'Lifestyle', 'food': 'Food'},
        'category_prompt': {},
    })

    class DummyMessage:
        text = 'Lifestyle'
        async def reply_text(self, text, reply_markup=None):
            raise AssertionError(text)

    async def fake_apply_direct_category_choice(update_target, ctx, item_index, choice, raw_category=None):
        calls.append(('apply', raw_category, choice))

    bot.apply_direct_category_choice = fake_apply_direct_category_choice

    import asyncio
    user = SimpleNamespace(id=72171277)
    update = SimpleNamespace(message=DummyMessage())
    update.message.from_user = user
    asyncio.run(bot.handle_text_instruction(update, context))

    assert calls == [('apply', None, 'Lifestyle')]


def test_find_ambiguous_categories_flags_none_like_category_values():
    bot = load_bot_module()
    rows = [
        {'item': 'Coffee', 'category': 'none'},
        {'item': 'Tea', 'category': None},
        {'item': 'Lunch', 'category': 'Food'},
    ]

    ambiguous = bot.find_ambiguous_categories(rows, ['Food', 'Lifestyle'])

    assert ambiguous == [
        {'index': 0, 'raw_category': 'none'},
        {'index': 1, 'raw_category': '(missing category)'},
    ]


def test_start_message_is_personalized():
    bot = load_bot_module()

    assert bot.start_message('Yi Jia') == "Hello, Yi Jia! Send me a receipt or screenshot of your transactions and I'll log them for you ☺️."


def test_help_message_lists_supported_commands():
    bot = load_bot_module()
    text = bot.help_message()

    assert '/start' in text
    assert '/help' in text
    assert '/manual' in text
    assert '/cancel' in text
    assert 'item | amount | category | date | remarks' in text


def test_approve_in_progress_message_is_friendly():
    bot = load_bot_module()

    assert bot.approve_in_progress_message('Yi Jia') == 'Hold tight, Yi Jia — updating your expense log...'


def test_parse_manual_entries_supports_multiple_lines_and_optional_fields():
    bot = load_bot_module()

    rows = bot.parse_manual_entries(
        'Coffee | 4.50 | Food | 2026-05-04 | team sync\nBus ride | 1.23 | none'
    )

    assert rows[0] == {
        'item': 'Coffee',
        'amount': 4.5,
        'category': 'Food',
        'date': '2026-05-04',
        'remarks': 'team sync',
    }
    assert rows[1]['item'] == 'Bus ride'
    assert rows[1]['amount'] == 1.23
    assert rows[1]['category'] == 'none'
    assert rows[1]['remarks'] == ''
    assert rows[1]['date']


def test_parse_manual_entries_supports_simple_space_separated_format():
    bot = load_bot_module()

    rows = bot.parse_manual_entries('Coffee 4.50 Food\nBus 1.20 Transport')

    assert rows[0]['item'] == 'Coffee'
    assert rows[0]['amount'] == 4.5
    assert rows[0]['category'] == 'Food'
    assert rows[0]['remarks'] == ''
    assert rows[1]['item'] == 'Bus'
    assert rows[1]['amount'] == 1.2
    assert rows[1]['category'] == 'Transport'


def test_parse_manual_entries_supports_simple_format_with_multi_word_item():
    bot = load_bot_module()

    rows = bot.parse_manual_entries('Bubble Tea 6.80 Food')

    assert rows[0]['item'] == 'Bubble Tea'
    assert rows[0]['amount'] == 6.8
    assert rows[0]['category'] == 'Food'


def test_handle_text_instruction_accepts_manual_mode_without_pending_rows():
    import asyncio

    bot = load_bot_module()

    captured = {}

    async def fake_show_preview_or_ask_category(update_target, context, rows):
        captured['rows'] = rows

    bot.show_preview_or_ask_category = fake_show_preview_or_ask_category
    bot.fetch_relation_options = lambda target_db: ['Food', 'Lifestyle']

    class DummyMessage:
        text = 'Coffee | 4.50 | Food | 2026-05-04'

        def __init__(self):
            self.replies = []

        async def reply_text(self, text, reply_markup=None):
            self.replies.append(text)

    msg = DummyMessage()
    user = SimpleNamespace(id=72171277, first_name='Yi Jia', full_name='Yi Jia')
    msg.from_user = user
    update = SimpleNamespace(message=msg)
    context = SimpleNamespace(user_data={'edit_state': {'mode': 'manual_add'}})

    asyncio.run(bot.handle_text_instruction(update, context))

    assert context.user_data['pending_rows'][0]['item'] == 'Coffee'
    assert captured['rows'][0]['category'] == 'Food'
    assert msg.replies == []
