"""Monitoring rules use fixed snapshots; no network, database or mail is contacted."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess

spec = importlib.util.spec_from_file_location('watchdog', Path(__file__).resolve().parents[1] / 'scripts/filmtech-watchdog.py')
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)

class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.sample = {'services': {'api': True, 'worker': True}, 'http_ok': True, 'db_ok': True,
                       'daily_limit': 1000, 'usage': {'day': 350, 'hour': 39, 'content_hour': 38, 'stale_calls': 0},
                       'heartbeat_age': 60, 'scheduling_age': 30, 'analysis_age': 6000,
                       'waiting': 100, 'failing_sources': 0, 'expected_reports': {}, 'reports': []}

    def test_hourly_wait_is_not_a_failure(self):
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_stalled_processing_with_available_slots_is_reported(self):
        self.sample['usage']['content_hour'] = 20
        self.assertTrue(any('九十五分钟' in p for p in watchdog.problems(self.sample)))

    def test_daily_exhaustion_with_waiting_articles_is_reported(self):
        self.sample['usage']['day'] = 1000
        self.assertTrue(any('滚动额度耗尽' in p for p in watchdog.problems(self.sample)))

    def test_empty_but_generated_daily_report_is_valid(self):
        self.sample['expected_reports'] = {'daily': '2026-10-01'}
        self.sample['reports'] = [{'kind': 'daily', 'key': '2026-10-01', 'items': 0}]
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_missing_report_and_stale_heartbeat_are_reported(self):
        self.sample['expected_reports'] = {'daily': '2026-10-01'}
        self.sample['heartbeat_age'] = 300
        self.assertEqual(len(watchdog.problems(self.sample)), 2)

    def test_database_failure_does_not_require_partial_metrics(self):
        self.assertEqual(watchdog.problems({'services': {}, 'http_ok': True, 'db_ok': False}), ['数据库运行统计读取失败'])

    def test_public_log_access_and_unknown_provider_result_are_reported(self):
        self.sample['log_protected'] = False
        self.sample['usage']['unknown_hour'] = 1
        self.assertEqual(len(watchdog.problems(self.sample)), 2)

    def test_mail_timeout_does_not_stop_monitoring(self):
        with patch.object(watchdog, 'run', side_effect=subprocess.TimeoutExpired('test', 30)):
            self.assertFalse(watchdog.send_email({'recipient': 'test@example.invalid'}, 'test', 'test'))

if __name__ == '__main__': unittest.main()
