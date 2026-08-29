import logging
from pathlib import Path

from .config import Settings


logger = logging.getLogger(__name__)


class AudioStorage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.settings.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.supabase = None
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
        safe_name = Path(filename).name.replace(' ', '_')
        if self.supabase:
            try:
                self.supabase.storage.from_(self.settings.supabase_bucket).upload(
                    safe_name,
                    data,
                    {'content-type': content_type, 'upsert': 'true'},
                )
                return self.supabase.storage.from_(self.settings.supabase_bucket).get_public_url(safe_name)
            except Exception as exc:
                # Storage must not prevent the event row from being committed.
                logger.exception('Supabase audio upload failed for %s: %s; using local fallback.', safe_name, exc)
        return self._save_local(data, safe_name)
