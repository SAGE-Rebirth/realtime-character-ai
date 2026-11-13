# Agent worker (Python, LiveKit Agents + Gemini Live). Build from the repository root:
#   docker build -f infra/docker/worker.Dockerfile .
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
RUN useradd --create-home --uid 10001 app
WORKDIR /app/services/agent-worker

COPY services/agent-worker/pyproject.toml services/agent-worker/uv.lock services/agent-worker/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/agent-worker/agent_worker agent_worker
RUN uv sync --frozen --no-dev && chown -R app:app /app

USER app
ENV PYTHONUNBUFFERED=1 PYTHONWARNINGS=ignore::SyntaxWarning
CMD ["/app/services/agent-worker/.venv/bin/python", "-m", "agent_worker.main", "start"]
