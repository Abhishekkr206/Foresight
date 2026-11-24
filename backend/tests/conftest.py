import pytest


@pytest.fixture
def login_credentials(monkeypatch):
    from app.config import get_settings
    from pydantic import SecretStr

    settings = get_settings()
    monkeypatch.setattr(settings, 'foresight_login_id', 'test-operator')
    monkeypatch.setattr(settings, 'foresight_login_password', SecretStr('test-password'))
    monkeypatch.setattr(settings, 'foresight_jwt_secret', SecretStr('test-signing-key-' * 3))
    return {'login_id': 'test-operator', 'password': 'test-password'}


@pytest.fixture
def sign_in(login_credentials):
    def authenticate(client):
        response = client.post('/api/auth/login', json=login_credentials)
        assert response.status_code == 200
        token = response.json()['access_token']
        client.headers['Authorization'] = f'Bearer {token}'
        return token

    return authenticate
