FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY services/requirements.txt ./services/requirements.txt
RUN pip install --no-cache-dir -r services/requirements.txt \
    && useradd --system --uid 10001 --no-create-home results
COPY services/*.py ./services/
USER 10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "services.app:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "32", "--backlog", "64", "--timeout-keep-alive", "5", "--no-access-log"]
