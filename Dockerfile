FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements-render-lite.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY backend/app /app/app
COPY beacons_config.json /app/beacons_config.json
COPY backend/audio /app/backend/audio
COPY backend/models /app/backend/models
ENV PYTHONPATH=/app
ENV CLASSIFIER_BACKEND=lite
CMD uvicorn app.main:app --host 0.0.0.0 --port $PORT