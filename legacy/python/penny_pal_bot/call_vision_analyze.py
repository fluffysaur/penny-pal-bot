#!/usr/bin/env python3
"""Compatibility shim for calling the assistant's vision helper from a subprocess."""

import json
import os
import shutil
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG = LOG_DIR / 'call_vision_analyze.log'
QUESTION = (
    'Extract expense transaction rows from this image. '
    'Return ONLY a raw JSON array. No markdown, no prose. '
    'Each row object should contain: item, amount, date, category, confidence. '
    'Use positive numbers for normal expenses, but use negative numbers when the image clearly shows a refund, reimbursement, payback, or money received back.'
)
HERMES_TIMEOUT = int(os.getenv('EXPENSE_BOT_HERMES_TIMEOUT', '240'))


def log(msg: str):
    try:
        with LOG.open('a') as f:
            f.write(f"{datetime.utcnow().isoformat()}Z | {msg}\n")
    except Exception:
        pass


def emit_empty(exit_code: int = 0):
    try:
        print('[]')
    except BrokenPipeError:
        return
    sys.exit(exit_code)


def extract_json_array(text: str):
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ('analysis', 'result', 'rows', 'data', 'content', 'text'):
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
        candidate = text[first:last + 1]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    return []


def run_via_hermes_cli(image: str):
    prompt = (
        f"Use the vision_analyze tool on this local image path: {image}\n\n"
        f"Question for the tool: {QUESTION}\n\n"
        "Return ONLY the JSON array and nothing else."
    )

    hermes_candidates = []
    env_path = os.environ.get('PATH', '')
    for candidate in (
        shutil.which('hermes'),
        shutil.which('hermes-cli'),
        '/home/ubuntu/.local/bin/hermes',
        '/home/ubuntu/.local/bin/hermes-cli',
    ):
        if candidate and candidate not in hermes_candidates:
            hermes_candidates.append(candidate)

    log(f'run_via_hermes_cli PATH={env_path!r} candidates={hermes_candidates!r}')

    for cmd in hermes_candidates:
        try:
            proc = subprocess.run(
                [cmd, 'chat', '-Q', '-t', 'vision', '-q', prompt],
                capture_output=True,
                text=True,
                timeout=HERMES_TIMEOUT,
                env=dict(os.environ),
            )
            stdout = (proc.stdout or '').strip()
            stderr = (proc.stderr or '').strip()
            log(
                f"hermes chat finished cmd={cmd!r} rc={proc.returncode} "
                f"stdout_snippet={stdout[:500]!r} stderr_snippet={stderr[:500]!r}"
            )
            if proc.returncode != 0:
                continue

            rows = extract_json_array(stdout)
            if rows:
                return rows
        except Exception:
            log(f'hermes CLI invocation raised for {cmd!r}: ' + traceback.format_exc())
    return []


if __name__ == '__main__':
    if len(sys.argv) < 2:
        log('No image path provided')
        emit_empty(2)

    image = sys.argv[1]
    if not os.path.exists(image):
        log(f'Image not found: {image}')
        emit_empty(0)

    log(f'Starting call_vision_analyze for image={image}')

    try:
        try:
            from hermes_tools import vision_analyze  # type: ignore
        except Exception as e:
            log('hermes_tools import failed: ' + repr(e))
            vision_analyze = None

        if vision_analyze:
            try:
                res = vision_analyze(image_url=image, question=QUESTION)
                text = json.dumps(res) if isinstance(res, (list, dict)) else str(res)
                rows = extract_json_array(text)
                if rows:
                    print(json.dumps(rows))
                    sys.exit(0)
                log('direct hermes_tools path returned no parseable rows')
            except Exception:
                log('vision_analyze raised: ' + traceback.format_exc())

        rows = run_via_hermes_cli(image)
        if rows:
            print(json.dumps(rows))
            sys.exit(0)

        log('No rows extracted by any path')
        emit_empty(0)
    except Exception:
        log('Unhandled exception in call_vision_analyze: ' + traceback.format_exc())
        emit_empty(0)
