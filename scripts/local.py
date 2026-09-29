#!/usr/bin/env python3
"""Start/stop this checkout's local preview; credentials stay in the ignored .env."""
import json, os, shutil, signal, subprocess, sys, time, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.data/runtime'
PGDATA = ROOT / '.data/postgres-local'
STATE = RUNTIME / 'processes.json'
PGPORT = '55440'

def pgtool(name):
    candidates = [shutil.which(name), f'/opt/homebrew/opt/postgresql@17/bin/{name}']
    for candidate in candidates:
        if candidate and Path(candidate).is_file(): return candidate
    raise SystemExit('PostgreSQL 17 tools are required.')

def run(*cmd, **kwargs):
    return subprocess.run(cmd, cwd=ROOT, check=True, **kwargs)

def alive(entry):
    try:
        command = subprocess.check_output(['ps', '-p', str(entry['pid']), '-o', 'command='], text=True)
        return entry['script'] in command and str(ROOT / '.env') in command
    except subprocess.CalledProcessError: return False

def status():
    entries = json.loads(STATE.read_text()) if STATE.exists() else []
    for entry in entries: print(f"{entry['name']}: {'running' if alive(entry) else 'stopped'}")
    return entries

def stop():
    for entry in status():
        if alive(entry): os.kill(entry['pid'], signal.SIGTERM)
    deadline = time.monotonic() + 215
    while any(alive(e) for e in (json.loads(STATE.read_text()) if STATE.exists() else [])):
        if time.monotonic() > deadline: raise SystemExit('A process is still draining; database left running. Retry status.')
        time.sleep(1)
    if PGDATA.exists():
        if subprocess.run([pgtool('pg_ctl'), '-D', str(PGDATA), 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            run(pgtool('pg_ctl'), '-D', str(PGDATA), 'stop', '-m', 'fast')
    print('Local preview stopped; data preserved.')

def start():
    if not (ROOT / '.env').exists(): raise SystemExit('Create .env first; see docs/filmtech-local.md.')
    entries = json.loads(STATE.read_text()) if STATE.exists() else []
    if any(alive(e) for e in entries): raise SystemExit('A local process is already running. Use status or stop first.')
    RUNTIME.mkdir(parents=True, exist_ok=True)
    if not PGDATA.exists():
        run(pgtool('initdb'), '-D', str(PGDATA), '-A', 'trust', '--encoding=UTF8', '--locale=C', stdout=subprocess.DEVNULL)
    if subprocess.run([pgtool('pg_ctl'), '-D', str(PGDATA), 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        run(pgtool('pg_ctl'), '-D', str(PGDATA), '-l', str(RUNTIME/'postgres.log'), '-o', f'-h 127.0.0.1 -p {PGPORT} -k {RUNTIME}', 'start')
    check=subprocess.run([pgtool('psql'),'-h','127.0.0.1','-p',PGPORT,'-d','postgres','-Atc',"SELECT 1 FROM pg_database WHERE datname='filmtech_local'"],capture_output=True,text=True,check=True)
    if check.stdout.strip()!='1': run(pgtool('createdb'),'-h','127.0.0.1','-p',PGPORT,'filmtech_local')
    node=shutil.which('node')
    for script in ['migrate','seed']:
        run(node,f'--env-file={ROOT / ".env"}',str(ROOT/f'scripts/{script}.ts'))
    entries=[]
    try:
        services=[('api','apps/api/src/main.ts'),('worker','apps/worker/src/main.ts'),('web','apps/web/server.ts')]
        if any(line.startswith('CODEX_BRIDGE_TOKEN=') and line.split('=',1)[1].strip() for line in (ROOT/'.env').read_text().splitlines()):
            services.insert(0,('codex-bridge','scripts/codex-bridge.mjs'))
        for name,script in services:
            env=os.environ.copy()
            if name=='web':env['NODE_ENV']='production'
            absolute=str(ROOT/script)
            with (RUNTIME/f'{name}.log').open('a') as log:
                proc=subprocess.Popen([node,f'--env-file={ROOT / ".env"}',absolute],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            entries.append(dict(name=name,pid=proc.pid,script=absolute))
            STATE.write_text(json.dumps(entries,indent=2))
        for _ in range(30):
            if not all(alive(e) for e in entries): raise RuntimeError('A service exited; inspect .data/runtime/*.log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:3310/api/health',timeout=2) as response:
                    if response.status==200: print('Local preview: http://127.0.0.1:3310'); return
            except Exception: time.sleep(1)
        raise RuntimeError('Health check timed out.')
    except Exception:
        for entry in entries:
            if alive(entry):os.kill(entry['pid'],signal.SIGTERM)
        raise

if __name__=='__main__':
    command=sys.argv[1] if len(sys.argv)>1 else 'status'
    if command not in ['start','stop','status']:raise SystemExit('Usage: python3 scripts/local.py start|stop|status')
    {'start':start,'stop':stop,'status':status}[command]()
