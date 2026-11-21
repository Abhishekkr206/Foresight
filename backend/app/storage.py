import logging
from pathlib import Path
from queue import Queue, Empty, Full
from threading import Event as ThreadEvent, Thread

from .config import Settings


logger = logging.getLogger(__name__)


class AudioStorage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.settings.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.supabase = None
        self._queue = Queue(maxsize=32)
        self._shutdown = ThreadEvent()
        self._worker = None
        if settings.supabase_url and settings.supabase_service_role_key:
            try:
                from supabase import create_client

                project_url = settings.supabase_url.strip().rstrip('/')
                for suffix in ('/rest/v1', '/rest'):
                    if project_url.endswith(suffix):
                        project_url = project_url[:-len(suffix)]
                        break
                self.supabase = create_client(project_url, settings.supabase_service_role_key)
            except ImportError:
                logger.warning('Supabase package is not installed; using local audio storage.')
            except Exception:
                logger.exception('Supabase client could not be initialized; using local audio storage.')

    def _save_local(self, data: bytes, safe_name: str) -> str:
        path = self.settings.uploads_dir / safe_name
        path.write_bytes(data)
        return f'/uploads/{safe_name}'

    def save(self, data: bytes, filename: str, content_type: str = 'audio/wav') -> str:
        """Always make playback durable locally without waiting for cloud storage."""
        safe_name = Path(filename).name.replace(' ', '_')
        return self._save_local(data, safe_name)

    def start_uploader(self, db_factory, broadcaster):
        if not self.supabase or (self._worker and self._worker.is_alive()):
            return
        self._shutdown.clear()
        self._worker = Thread(target=self._upload_loop, args=(db_factory, broadcaster), daemon=True)
        self._worker.start()

    def queue_upload(self, event_id, data, filename, content_type):
        if not self.supabase or not self._worker or not self._worker.is_alive() or self._shutdown.is_set():
            return False
        try:
            self._queue.put_nowait((event_id, data, filename, content_type))
            return True
        except Full:
            logger.warning('Audio upload queue is full; retaining local recording for event %s', event_id)
            return False

    def stop_uploader(self):
        self._shutdown.set()
        if self._worker:
            self._worker.join(timeout=1)

    def _upload_loop(self, db_factory, broadcaster):
        from .models import Event
        while not self._shutdown.is_set():
            try:
                event_id, data, filename, content_type = self._queue.get(timeout=0.1)
            except Empty:
                continue
            try:
                bucket = self.supabase.storage.from_(self.settings.supabase_bucket)
                bucket.upload(filename, data, {'content-type': content_type, 'upsert': 'true'})
                url = bucket.get_public_url(filename)
                with db_factory() as db:
                    event = db.get(Event, event_id)
                    if event:
                        event.audio_file_url = url
                        db.commit()
                        db.refresh(event)
                        broadcaster({'type': 'event.updated', 'data': event})
            except Exception:
                logger.exception('Cloud audio upload failed; retaining local recording for event %s', event_id)
            finally:
                self._queue.task_done()
