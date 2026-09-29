#!/usr/bin/env python3
"""Run the private local generator against Tencent's DB through SSH. No public model endpoint."""
import os, signal, socket, subprocess, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.data/cloud-worker'
ENV = RUNTIME / 'worker.env'
children = []
stopping = False

def stop_children():
    # Drain the worker while its model listener and database tunnel are still available.
    deadline = time.monotonic() + 215
    for child in reversed(children):
        if child.poll() is None: child.terminate()
        try: child.wait(timeout=max(1, deadline-time.monotonic()))
        except subprocess.TimeoutExpired: child.kill(); child.wait()
    children.clear()

def shutdown(_signum, _frame):
    global stopping
    stopping = True

for sig in [signal.SIGINT,signal.SIGTERM]: signal.signal(sig,shutdown)
if not ENV.is_file(): raise SystemExit('Missing .data/cloud-worker/worker.env; see docs/filmtech-cloud.md')
RUNTIME.mkdir(exist_ok=True)
os.umask(0o077)
node = '/opt/homebrew/bin/node'
commands = [
    ['/usr/bin/ssh','-NT','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-L','127.0.0.1:55441:127.0.0.1:55441','tencent-cloud'],
    [node,f'--env-file={ENV}',str(ROOT/'scripts/codex-bridge.mjs')],
    [node,f'--env-file={ENV}',str(ROOT/'apps/worker/src/main.ts')],
]
try:
    while not stopping:
        for name,command in zip(['tunnel','codex','worker'],commands):
            if stopping: break
            with (RUNTIME/f'{name}.log').open('a') as log:
                children.append(subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT))
            if name=='tunnel':
                for _ in range(30):
                    if stopping or children[-1].poll() is not None: break
                    try:
                        with socket.create_connection(('127.0.0.1',55441),timeout=1):break
                    except OSError:time.sleep(1)
                else:children[-1].terminate()
            if children[-1].poll() is not None:break
        while not stopping and len(children)==3 and all(c.poll() is None for c in children):time.sleep(1)
        stop_children()
        for _ in range(20):
            if stopping:break
            time.sleep(1)
finally:stop_children()
