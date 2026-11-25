from datetime import datetime, timezone
from secrets import compare_digest
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, SecretStr

from .config import Settings, get_settings


ISSUER = 'foresight'
TOKEN_SECONDS = 3600
router = APIRouter(prefix='/api/auth')
bearer = HTTPBearer(auto_error=False)
AppSettings = Annotated[Settings, Depends(get_settings)]


class Login(BaseModel):
    login_id: str
    password: SecretStr


def signing_key(settings: Settings) -> str:
    secret = settings.foresight_jwt_secret.get_secret_value()
    if not settings.foresight_login_id.strip() or not settings.foresight_login_password.get_secret_value() or len(secret.encode()) < 32:
        raise HTTPException(503, 'Login is not configured')
    return secret


def unauthorized(message: str = 'Sign in to continue') -> HTTPException:
    return HTTPException(401, message, headers={'WWW-Authenticate': 'Bearer'})


def verify_token(token: str, settings: Settings) -> int:
    try:
        claims = jwt.decode(
            token, signing_key(settings), algorithms=['HS256'], issuer=ISSUER,
            subject=settings.foresight_login_id,
            options={'require': ['iss', 'sub', 'iat', 'exp']},
        )
    except jwt.InvalidTokenError as exc:
        raise unauthorized() from exc
    return claims['exp']


def require_session(
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> int:
    if credentials is None:
        raise unauthorized()
    return verify_token(credentials.credentials, settings)


@router.post('/login')
def login(payload: Login, settings: AppSettings, response: Response):
    secret = signing_key(settings)
    valid_id = compare_digest(payload.login_id.encode(), settings.foresight_login_id.encode())
    valid_password = compare_digest(
        payload.password.get_secret_value().encode(),
        settings.foresight_login_password.get_secret_value().encode(),
    )
    if not (valid_id and valid_password):
        raise unauthorized('Invalid login ID or password')
    now = int(datetime.now(timezone.utc).timestamp())
    token = jwt.encode(
        {'iss': ISSUER, 'sub': settings.foresight_login_id, 'iat': now, 'exp': now + TOKEN_SECONDS},
        secret, algorithm='HS256',
    )
    response.headers['Cache-Control'] = 'no-store'
    return {'access_token': token, 'token_type': 'bearer', 'expires_in': TOKEN_SECONDS}


@router.get('/session')
def session(expiry: Annotated[int, Depends(require_session)], response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return {'expires_at': expiry}
