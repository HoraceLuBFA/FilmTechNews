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
                       'waiting': 100, 'queue': {'pending': 100, 'analysis_ready': 100, 'analysis_ready_age': 6000},
                       'failing_sources': 0, 'expected_reports': {}, 'reports': []}

    def test_hourly_wait_is_not_a_failure(self):
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_failed_material_remains_reported_while_other_work_continues(self):
        self.sample['queue'] = {'pending': 100, 'failed': 1}
        self.sample['usage']['pending_calls'] = 1
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'processing')
        self.assertEqual(watchdog.problems(self.sample), ['有失败材料尚未恢复，请检查处理队列'])
        self.sample['usage']['pending_calls'] = 0
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'hourly_limit')
        self.assertEqual(len(watchdog.problems(self.sample)), 1)
        self.sample['queue']['failed'] = 0
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_stalled_processing_with_available_slots_is_reported(self):
        self.sample['usage']['content_hour'] = 20
        self.assertTrue(any('九十五分钟' in p for p in watchdog.problems(self.sample)))

    def test_future_retry_and_extraction_only_are_not_model_stalls(self):
        self.sample['usage']['content_hour'] = 0
        self.sample['queue'] = {'pending': 1, 'deferred': 1, 'extraction_waiting': 1, 'analysis_ready': 0}
        self.assertEqual(watchdog.problems(self.sample), [])
        self.sample['queue'].update(deferred=0, extraction_ready=1, extraction_ready_age=30)
        self.sample['extraction_age'] = 60
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_new_arrival_after_quiet_period_and_inflight_work_are_not_stalls(self):
        self.sample['usage']['content_hour'] = 0
        self.sample['analysis_age'] = 20000
        self.sample['queue']['analysis_ready_age'] = 30
        self.assertEqual(watchdog.problems(self.sample), [])
        self.sample['queue']['analysis_ready_age'] = 20000
        self.sample['usage']['pending_calls'] = 1
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_overdue_extraction_without_progress_is_still_reported(self):
        self.sample['queue'] = {'pending': 1, 'analysis_ready': 0, 'extraction_ready': 1, 'extraction_ready_age': 6000}
        self.sample['extraction_age'] = 6000
        self.assertEqual(watchdog.problems(self.sample), ['正文提取任务超过九十五分钟未推进'])

    def test_overdue_work_that_never_started_is_still_reported(self):
        self.sample['usage']['content_hour'] = 0
        self.sample['analysis_age'] = None
        self.assertTrue(any('九十五分钟' in p for p in watchdog.problems(self.sample)))
        self.sample['queue'] = {'extraction_ready': 1, 'extraction_ready_age': 6000}
        self.sample['extraction_age'] = None
        self.assertEqual(watchdog.problems(self.sample), ['正文提取任务超过九十五分钟未推进'])

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

    def test_hourly_wait_explains_release_without_claiming_failure(self):
        self.sample['usage']['content_release_at'] = '2026-10-01T15:00:00+00:00'
        state = watchdog.processing_status(self.sample)
        self.assertEqual(state['code'], 'hourly_limit')
        self.assertEqual(state['resume_at'], self.sample['usage']['content_release_at'])
        self.assertEqual(watchdog.problems(self.sample), [])

    def test_total_hourly_limit_uses_total_release(self):
        self.sample['usage'].update(hour=40, hour_release_at='total', content_release_at='content')
        self.assertEqual(watchdog.processing_status(self.sample)['resume_at'], 'total')

    def test_daily_limit_takes_precedence_over_hourly_wait(self):
        self.sample['usage'].update(day=1000, day_release_at='daily')
        state = watchdog.processing_status(self.sample)
        self.assertEqual(state['code'], 'daily_limit')
        self.assertEqual(state['resume_at'], 'daily')

    def test_in_flight_call_is_processing_even_when_slots_are_full(self):
        self.sample['usage']['pending_calls'] = 1
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'processing')

    def test_pending_and_failed_materials_are_not_conflated(self):
        self.sample['queue'] = {'pending': 0, 'failed': 4}
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'failed')
        self.sample['queue']['failed'] = 0
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'idle')

    def test_retry_wait_and_available_queue_are_distinct(self):
        self.sample['usage']['content_hour'] = 20
        self.sample['queue'] = {'pending': 4, 'deferred': 4, 'retry_at': 'retry'}
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'retry')
        self.assertEqual(watchdog.processing_status(self.sample)['resume_at'], 'retry')
        self.sample['queue']['deferred'] = 3
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'queued')

    def test_service_failure_and_unknown_outcome_are_not_normal_waits(self):
        self.sample['services']['worker'] = False
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'unavailable')
        self.sample['services']['worker'] = True
        self.sample['usage']['unknown_hour'] = 1
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'unavailable')

    def test_live_hourly_configuration_controls_status_and_stall_check(self):
        self.sample.update(hour_limit=50, content_hour_limit=48)
        self.assertEqual(watchdog.processing_status(self.sample)['code'], 'queued')
        self.assertTrue(any('九十五分钟' in p for p in watchdog.problems(self.sample)))

if __name__ == '__main__': unittest.main()
