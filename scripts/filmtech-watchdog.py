#!/usr/bin/env python3
"""Read-only, model-free supervision. All published output is a whitelist of aggregate metrics."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SQL = """
WITH g AS (SELECT value FROM settings WHERE key='llm_budget_grace'),
usage AS (SELECT count(*) FILTER(WHERE a.id>coalesce((SELECT (value->>'baselineMaxId')::bigint FROM g),0)) AS day,
 count(*) FILTER(WHERE a.started_at>now()-interval '1 hour' AND a.status<>'failed') AS hour,
 count(*) FILTER(WHERE a.started_at>now()-interval '1 hour' AND a.status<>'failed' AND left(r.purpose,7)<>'report_') AS content_hour,
 count(*) FILTER(WHERE a.started_at>now()-interval '1 hour' AND a.status='failed') AS failed_hour,
 count(*) FILTER(WHERE a.started_at>now()-interval '1 hour' AND a.status='unknown') AS unknown_hour,
 count(*) FILTER(WHERE a.status='pending') AS pending_calls,
 min(a.started_at) FILTER(WHERE a.status<>'failed' AND a.started_at>now()-interval '1 hour') + interval '1 hour' AS hour_release_at,
 min(a.started_at) FILTER(WHERE a.status<>'failed' AND a.started_at>now()-interval '1 hour' AND left(r.purpose,7)<>'report_') + interval '1 hour' AS content_release_at,
 min(a.started_at) FILTER(WHERE a.id>coalesce((SELECT (value->>'baselineMaxId')::bigint FROM g),0)) + interval '1 day' AS day_release_at,
 count(*) FILTER(WHERE a.status='pending' AND a.started_at<now()-interval '10 minutes') AS stale_calls
 FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
 WHERE a.service='llm' AND a.origin='live' AND a.started_at>now()-interval '1 day'),
queue AS (SELECT count(*) FILTER(WHERE processing_state='new') AS pending,
 count(*) FILTER(WHERE processing_state='failed') AS failed,
 count(*) FILTER(WHERE processing_state='new' AND processing_retry_at>now()) AS deferred,
 count(*) FILTER(WHERE processing_state='new' AND processing_error LIKE 'extract:%') AS extraction_waiting,
 min(processing_retry_at) FILTER(WHERE processing_state='new' AND processing_retry_at>now()) AS retry_at
 FROM articles WHERE processing_state IN ('new','failed')),
public AS (SELECT * FROM publications WHERE eligible AND visibility='public' AND (NOT selected OR visible_after<=now()))
SELECT jsonb_build_object(
 'usage',(SELECT to_jsonb(u) FROM usage u),
 'daily_limit',coalesce((SELECT (value->'original'->>'per_day')::int FROM g),(SELECT per_day FROM budgets WHERE service='llm')),
 'heartbeat_age',(SELECT extract(epoch FROM now()-updated_at)::int FROM settings WHERE key='heartbeat.worker'),
 'scheduling_age',(SELECT extract(epoch FROM now()-max(finished_at))::int FROM job_runs WHERE job='sources.schedule' AND status='ok'),
 'analysis_age',(SELECT extract(epoch FROM now()-max(created_at))::int FROM analyses WHERE origin='model'),
 'analysis_total',(SELECT count(*) FROM analyses WHERE origin='model'),
 'analyzed_hour',(SELECT count(*) FROM analyses WHERE origin='model' AND created_at>now()-interval '1 hour'),
 'last_analysis_at',(SELECT max(created_at) FROM analyses WHERE origin='model'),
 'last_collection_at',(SELECT max(created_at) FROM articles WHERE NOT backfill),
 'raw_total',(SELECT count(*) FROM articles),
 'raw_hour',(SELECT count(*) FROM articles WHERE NOT backfill AND created_at>now()-interval '1 hour'),
 'waiting',(SELECT count(*) FROM articles WHERE processing_state IN ('new','failed')),
 'queue',(SELECT to_jsonb(q) FROM queue q),
 'public_total',(SELECT count(*) FROM public),
 'last_public_change_at',(SELECT max(updated_at) FROM public),
 'latest_timeline_at',(SELECT max(timeline_at) FROM public),
 'public_changed_hour',(SELECT count(*) FROM public WHERE updated_at>now()-interval '1 hour'),
 'sources',(SELECT count(*) FROM sources WHERE enabled),
 'failing_sources',(SELECT count(*) FROM sources WHERE enabled AND fail_count>=3),
 'reports',(SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT DISTINCT ON(kind) kind,key,generated_at,
 CASE WHEN kind='daily' THEN coalesce((content->'metrics'->>'totalEvents')::int,0)
 ELSE coalesce((content->'metrics'->>'totalStories')::int,0) END AS items
 FROM reports ORDER BY kind,generated_at DESC) r));
"""

def run(command, **kwargs):
    return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True, timeout=kwargs.pop('timeout', 20), **kwargs)

def send_email(config, subject, text):
    try:
        result = run(['docker', 'exec', '-i', 'uptime-kuma', 'node', '-e',
                      (ROOT / 'scripts/watchdog-mail.cjs').read_text(encoding='utf-8')],
                     input=json.dumps({'to': config['recipient'], 'subject': subject, 'text': text}), timeout=30)
        return result.returncode == 0 and json.loads(result.stdout).get('ok') is True
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError): return False

def problems(s):
    found = []
    for name, healthy in s['services'].items():
        if not healthy: found.append(name + ' 服务不可用')
    if not s['http_ok']: found.append('网站或 API 健康检查失败')
    if s.get('log_protected') is False: found.append('私有日志访问保护异常')
    if not s['db_ok']: return found + ['数据库运行统计读取失败']
    if s.get('heartbeat_age') is None or s['heartbeat_age'] > 180: found.append('worker 心跳超过三分钟未更新')
    if s.get('scheduling_age') is None or s['scheduling_age'] > 900: found.append('来源调度超过十五分钟未成功')
    u = s['usage']
    if s['daily_limit'] != 1000: found.append('日常调用基准偏离已确认的1000次')
    if u['stale_calls']: found.append('模型请求超过十分钟仍未返回')
    if u.get('failed_hour', 0) >= 3 or u.get('unknown_hour', 0): found.append('本小时模型调用连续失败或存在未知结果')
    if s['waiting'] and u['day'] >= s['daily_limit']: found.append('日常滚动额度耗尽，材料仍在等待')
    elif (s['waiting'] and u['content_hour'] < s.get('content_hour_limit', 38) and (s.get('analysis_age') or 0) > 5700):
        found.append('有待处理材料且仍有调用空间，但分析超过九十五分钟未推进')
    if s['failing_sources']: found.append('有启用来源连续采集失败三次以上')
    for kind, key in s['expected_reports'].items():
        if not any(r['kind'] == kind and r['key'] == key for r in s.get('reports') or []):
            found.append({'daily': '日报', 'weekly': '周报', 'monthly': '月报'}[kind] + '未按期生成')
    return found

def processing_status(s):
    """Explain aggregate queue state without exposing provider errors or article contents."""
    result = {'code': 'unavailable', 'label': '运行异常', 'detail': '服务或数据库检查未通过，请查看异常提示。', 'resume_at': None}
    if not s.get('db_ok') or not s.get('http_ok') or not all(s.get('services', {}).values()): return result
    if s.get('heartbeat_age') is None or s['heartbeat_age'] > 180:
        result['detail'] = '处理进程心跳延迟，请查看异常提示。'; return result
    u, q = s.get('usage', {}), s.get('queue', {})
    pending = q.get('pending', s.get('waiting', 0))
    if u.get('stale_calls') or u.get('unknown_hour'):
        result['detail'] = '模型请求超时或结果待确认，请查看异常提示。'; return result
    if u.get('pending_calls', 0):
        return {'code': 'processing', 'label': '正在处理', 'detail': '{} 个模型请求在途，采集与摘要任务继续运行。'.format(u['pending_calls']), 'resume_at': None}
    if not pending:
        return {'code': 'failed' if q.get('failed') else 'idle', 'label': '等待人工处理' if q.get('failed') else '等待新材料',
                'detail': '{} 篇材料处理失败，需排查后重试。'.format(q['failed']) if q.get('failed') else '当前没有待分析材料，持续按计划检查信源。', 'resume_at': None}
    if u.get('day', 0) >= s.get('daily_limit', 1000):
        return {'code': 'daily_limit', 'label': '等待日额度', 'detail': '滚动 24 小时调用额度已满，旧请求移出窗口后逐步恢复。', 'resume_at': u.get('day_release_at')}
    if u.get('hour', 0) >= s.get('hour_limit', 40) or u.get('content_hour', 0) >= s.get('content_hour_limit', 38):
        total_full = u.get('hour', 0) >= s.get('hour_limit', 40)
        return {'code': 'hourly_limit', 'label': '等待小时额度', 'detail': '总调用已达滚动小时配额，额度释放后由队列继续处理。' if total_full else '内容处理已达滚动小时配额；报刊保留调用空间，额度释放后由队列继续处理。',
                'resume_at': u.get('hour_release_at') if total_full else u.get('content_release_at')}
    if q.get('deferred', 0) >= pending:
        return {'code': 'retry', 'label': '等待队列重试', 'detail': '待处理材料均处于重试等待期；采集继续运行。', 'resume_at': q.get('retry_at')}
    return {'code': 'queued', 'label': '等待队列调度', 'detail': '仍有处理额度，材料等待任务领取；部分处理中间步骤不产生模型请求。', 'resume_at': None}

def snapshot(now):
    s = {'at': now.isoformat(), 'services': {}, 'http_ok': True, 'db_ok': False}
    for name in ['api', 'worker', 'web', 'db']:
        r = run(['docker', 'inspect', '--format', '{{.State.Running}}', 'filmtechnews-' + name + '-1'])
        s['services'][name] = r.returncode == 0 and r.stdout.strip() == 'true'
    r = run(['systemctl', 'is-active', 'filmtech-codex.service'])
    s['services']['codex'] = r.stdout.strip() == 'active'
    r = run(['docker', 'exec', 'filmtechnews-worker-1', 'printenv', 'LLM_HOURLY_CALL_LIMIT', 'LLM_REPORT_HOURLY_RESERVE'])
    limits = r.stdout.splitlines()
    if r.returncode == 0 and len(limits) == 2 and all(v.isdigit() for v in limits):
        s['hour_limit'] = int(limits[0])
        s['content_hour_limit'] = max(0, int(limits[0]) - int(limits[1]))
    for url in ['http://127.0.0.1:3310/api/health', 'https://filmtech.lumenghe.com/api/health']:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                s['http_ok'] = s['http_ok'] and response.status == 200
        except Exception: s['http_ok'] = False
    try:
        with urllib.request.urlopen('https://filmtech.lumenghe.com/log/status.json', timeout=5): s['log_protected'] = False
    except urllib.error.HTTPError as error: s['log_protected'] = error.code == 401
    except Exception: s['log_protected'] = False
    r = run(['docker', 'exec', 'filmtechnews-db-1', 'psql', '-X', '-qAt', '-U', 'aihot', '-d', 'aihot', '-c', SQL])
    if r.returncode == 0:
        try: s.update(json.loads(r.stdout)); s['db_ok'] = True
        except ValueError: pass
    expected = {}
    if now.hour >= 9: expected['daily'] = now.date().isoformat()
    if now.weekday() == 0 and now.hour >= 11:
        y, w, _ = (now.date() - dt.timedelta(days=7)).isocalendar()
        expected['weekly'] = '{}-W{:02d}'.format(y, w)
    if now.day == 1 and (now.hour, now.minute) >= (11, 30):
        expected['monthly'] = (now.date().replace(day=1) - dt.timedelta(days=1)).strftime('%Y-%m')
    s['expected_reports'] = expected
    s['problems'] = problems(s)
    s['status'] = 'attention' if s['problems'] else 'ok'
    s['processing'] = processing_status(s)
    return s

def atomic(path, value, mode):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=True), encoding='utf-8')
    os.chmod(str(temporary), mode)
    os.replace(str(temporary), str(path))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['sample', 'hourly', 'summary', 'test-email'], default='sample')
    args = parser.parse_args()
    config = json.loads(Path('/etc/filmtech-watchdog.json').read_text(encoding='utf-8'))
    directory = Path(config['directory']); directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.mode == 'test-email':
            ok = send_email(config, '[FilmTechNews] 监工邮件通道测试', '这是部署验收测试，并非生产故障。云端监工已配置每小时检查、每三小时汇总，异常可通过本邮件通道报告。运行日志：' + config['log_url'])
            print(json.dumps({'mail_test_ok': ok})); return 0 if ok else 1
        state_file = directory / 'state.json'
        state = json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {'alerts': {}, 'history': []}
        now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))); stamp = time.time()
        try: s = snapshot(now)
        except (OSError, subprocess.TimeoutExpired):
            s = {'at': now.isoformat(), 'status': 'attention', 'services': {}, 'http_ok': False,
                 'db_ok': False, 'problems': ['监工采样超时或运行工具不可用']}
            s['processing'] = processing_status(s)
        due = []
        for issue in s['problems']:
            alert = state['alerts'].setdefault(issue, {'seen': 0, 'last_seen': 0, 'sent': 0})
            if stamp - alert['last_seen'] >= 120: alert['seen'] += 1; alert['last_seen'] = stamp
            if alert['seen'] >= 2 and stamp - alert['sent'] >= 21600:
                due.append(issue)
        if due:
            ok = send_email(config, '[FilmTechNews] 运行异常', '{}\n{}\n查看：{}'.format(s['at'], '\n'.join(due), config['log_url']))
            state['mail_ok'] = ok; state['mail_at'] = s['at']
            if ok:
                for issue in due: state['alerts'][issue]['sent'] = stamp
        recovered = []
        for issue in list(state['alerts']):
            if issue not in s['problems']:
                alert = state['alerts'].pop(issue)
                if alert['sent']: recovered.append(issue)
        if recovered:
            state['mail_ok'] = send_email(config, '[FilmTechNews] 运行恢复', '\n'.join(recovered) + '\n以上异常已恢复。查看：' + config['log_url'])
            state['mail_at'] = s['at']
        if args.mode != 'sample':
            previous = next((h for h in reversed(state['history']) if h['mode'] == args.mode), None)
            delta = {}
            for name in ['raw_total', 'analysis_total', 'public_total']:
                if previous and name in s and name in previous: delta[name] = s[name] - previous[name]
            state['history'].append(dict(s, mode=args.mode, delta=delta))
            state['history'] = state['history'][-240:]
        state['latest'] = s
        atomic(state_file, state, 0o600)
        public = Path(config['public_directory']); public.mkdir(parents=True, exist_ok=True)
        atomic(public / 'status.json', {'latest': s, 'history': state['history'],
               'mail': {'configured': True, 'last_ok': state.get('mail_ok'), 'at': state.get('mail_at')}}, 0o644)
        print(json.dumps({'at': s['at'], 'mode': args.mode, 'status': s['status'], 'problem_count': len(s['problems'])}))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
