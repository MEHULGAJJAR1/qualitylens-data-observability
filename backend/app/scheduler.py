from __future__ import annotations

import logging

from app.database import new_session
from app.models import Schedule, utcnow
from app.services import run_monitoring

logger = logging.getLogger(__name__)
_scheduler = None


def _execute_schedule(schedule_id: str) -> None:
    db = None
    try:
        db = new_session()
        schedule = db.get(Schedule, schedule_id)
        if not schedule or not schedule.active:
            return
        dataset_id = schedule.dataset_id
        schedule.last_run_at = utcnow()
        db.commit()
        run = run_monitoring(db, dataset_id, trigger_type="scheduled")
        logger.info("scheduled_monitoring_finished", extra={"schedule_id": schedule_id, "run_id": run.id, "status": run.status})
    except Exception:
        logger.exception("scheduled_monitoring_failed", extra={"schedule_id": schedule_id})
        if db:
            db.rollback()
    finally:
        if db:
            db.close()


def start_scheduler() -> None:
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        logger.warning("apscheduler_not_installed; scheduled checks are disabled")
        return
    if _scheduler and _scheduler.running:
        return
    _scheduler = BackgroundScheduler(timezone="UTC", daemon=True)
    try:
        db = new_session()
        schedules = db.query(Schedule).filter(Schedule.active.is_(True)).all()
        for schedule in schedules:
            _scheduler.add_job(
                _execute_schedule, IntervalTrigger(minutes=schedule.interval_minutes),
                id=schedule.id, args=[schedule.id], replace_existing=True,
                max_instances=1, coalesce=True,
            )
        db.close()
    except Exception:
        logger.exception("scheduler_schedule_load_failed")
    _scheduler.start()
    logger.info("apscheduler_started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None


def sync_schedule(schedule: Schedule) -> None:
    if not _scheduler or not _scheduler.running:
        return
    try:
        from apscheduler.triggers.interval import IntervalTrigger
        if schedule.active:
            _scheduler.add_job(
                _execute_schedule, IntervalTrigger(minutes=schedule.interval_minutes),
                id=schedule.id, args=[schedule.id], replace_existing=True,
                max_instances=1, coalesce=True,
            )
        else:
            if _scheduler.get_job(schedule.id):
                _scheduler.remove_job(schedule.id)
    except Exception:
        logger.exception("scheduler_job_sync_failed", extra={"schedule_id": schedule.id})


def remove_schedule(schedule_id: str) -> None:
    if _scheduler and _scheduler.running and _scheduler.get_job(schedule_id):
        _scheduler.remove_job(schedule_id)
