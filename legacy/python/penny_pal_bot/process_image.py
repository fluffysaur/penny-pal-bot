#!/usr/bin/env python3
"""Process an image by delegating to the call_vision_analyze helper."""

import json
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = LOG_DIR / 'process_image.log'
CALL_SCRIPT = Path(__file__).resolve().with_name('call_vision_analyze.py')
CALL_TIMEOUT = int(__import__('os').getenv('EXPENSE_BOT_PROCESS_TIMEOUT', '300'))


def log(msg: str):
    with LOG_PATH.open('a') as f:
        f.write(f"{datetime.utcnow().isoformat()}Z | {msg}\n")


if __name__ == '__main__':
    try:
        if len(sys.argv) < 2:
            log('No image path provided')
            print(json.dumps([]))
            sys.exit(0)

        image = Path(sys.argv[1])
        log(f'Starting process_image for image={image}')
        if not image.exists():
            log(f'Image not found: {image}')
            print(json.dumps([]))
            sys.exit(0)

        proc = subprocess.run(
            [sys.executable, str(CALL_SCRIPT), str(image)],
            capture_output=True,
            text=True,
            timeout=CALL_TIMEOUT,
        )
        stdout = (proc.stdout or '').strip()
        stderr = (proc.stderr or '').strip()
        log(
            f'call_vision_analyze finished rc={proc.returncode} '
            f'stdout_snippet={stdout[:500]!r} stderr_snippet={stderr[:500]!r}'
        )

        if proc.returncode != 0 or not stdout:
            if not stdout:
                log('call_vision_analyze produced empty stdout')
            print(json.dumps([]))
            sys.exit(0)

        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, list):
                print(json.dumps(parsed))
                sys.exit(0)
            log(f'call_vision_analyze returned JSON but not a list: {type(parsed)}')
        except Exception:
            log('JSON parse error in process_image:\n' + traceback.format_exc())
            first = stdout.find('[')
            last = stdout.rfind(']')
            if first != -1 and last != -1 and last > first:
                candidate = stdout[first:last + 1]
                try:
                    parsed = json.loads(candidate)
                    if isinstance(parsed, list):
                        print(json.dumps(parsed))
                        sys.exit(0)
                except Exception:
                    log('Failed to salvage JSON from stdout candidate')

        print(json.dumps([]))
        sys.exit(0)
    except Exception:
        log('Unhandled exception in process_image:\n' + traceback.format_exc())
        print(json.dumps([]))
        sys.exit(0)
