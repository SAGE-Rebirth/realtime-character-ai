#!/usr/bin/env bash
# Runs the MetaAvatar dev stack in the background. Called by the Makefile:
#   run.sh start | stop | restart [service] | status | logs [service]
# Each service runs in its own process group, so stopping it also stops every child it spawned.
# Logs and PID files live in .run/ (git-ignored).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"
COMPOSE=(docker compose -f "$ROOT/infra/docker/compose.yaml")
SERVICES=(api worker studio)
STUDIO_URL="http://localhost:3100/playground"

green() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
red() { printf "  \033[31m✗\033[0m %s\n" "$1"; }
grey() { printf "  \033[90m-\033[0m %s\n" "$1"; }
say() { printf "\033[1m%s\033[0m\n" "$1"; }

cmd_for() {
  case "$1" in
    api) echo "pnpm --filter @metaavatar/api dev" ;;
    worker) echo "cd services/agent-worker && PYTHONWARNINGS=ignore::SyntaxWarning exec uv run python -m agent_worker.main start" ;;
    studio) echo "pnpm --filter @metaavatar/studio dev" ;;
  esac
}

port_for() {
  case "$1" in
    api) echo 8787 ;;
    studio) echo 3100 ;;
    *) echo "" ;;
  esac
}

pid_of() { [ -f "$RUN/$1.pid" ] && cat "$RUN/$1.pid"; }
is_running() { local p; p="$(pid_of "$1")" && [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

is_ready() {
  case "$1" in
    api) curl -sf --max-time 1 http://localhost:8787/health >/dev/null ;;
    studio) curl -s -o /dev/null --max-time 1 http://localhost:3100 ;;
    worker) grep -q "registered worker" "$RUN/worker.log" 2>/dev/null ;;
    livekit) curl -s -o /dev/null --max-time 1 http://localhost:7880 ;;
  esac
}

# --- First-run setup, done automatically and only when something is missing ------------------
ensure_setup() {
  cd "$ROOT" || exit 1
  if [ ! -f .env ]; then
    cp .env.example .env
    say "Created .env from .env.example. Add LIVE_MODEL_API_KEY to it, then run: make start"
    exit 1
  fi
  if ! grep -qE '^(LIVE_MODEL_API_KEY|GEMINI_API_KEY)=.+' .env; then
    red "No LIVE_MODEL_API_KEY in .env. Add your Google AI Studio key, then run: make start"
    exit 1
  fi
  if [ ! -d node_modules ]; then say "Installing Node dependencies (first run)…"; pnpm install || exit 1; fi
  if [ ! -d services/agent-worker/.venv ]; then
    say "Installing Python dependencies (first run)…"
    (cd services/agent-worker && uv sync) || exit 1
  fi
  if [ ! -d packages/protocol/dist ]; then
    say "Building the protocol package…"
    pnpm --filter @metaavatar/protocol build >/dev/null || exit 1
  fi
}

# --- Start ---------------------------------------------------------------------------------
start_service() {
  local svc="$1"
  if is_running "$svc"; then grey "$svc already running"; return; fi
  local port; port="$(port_for "$svc")"
  if [ -n "$port" ] && lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    red "$svc: port $port is already in use by another process (run: make stop)"
    return 1
  fi
  : >"$RUN/$svc.log"
  # perl setpgrp puts the service in its own process group (macOS has no setsid).
  nohup perl -e 'setpgrp(0, 0); exec @ARGV' bash -c "cd '$ROOT' && $(cmd_for "$svc")" \
    >>"$RUN/$svc.log" 2>&1 </dev/null &
  echo $! >"$RUN/$svc.pid"
}

wait_ready() {
  local deadline=$((SECONDS + 90)) pending=("$@") still svc
  while [ ${#pending[@]} -gt 0 ] && [ $SECONDS -lt $deadline ]; do
    still=()
    for svc in "${pending[@]}"; do
      if is_ready "$svc"; then
        green "$svc ready"
      elif [ "$svc" != livekit ] && ! is_running "$svc"; then
        red "$svc exited. Last lines of .run/$svc.log:"
        tail -n 15 "$RUN/$svc.log" | sed 's/^/      /'
      else
        still+=("$svc")
      fi
    done
    pending=("${still[@]+"${still[@]}"}")
    [ ${#pending[@]} -gt 0 ] && sleep 1
  done
  for svc in "${pending[@]+"${pending[@]}"}"; do
    red "$svc not ready after 90 s (see: make logs s=$svc)"
  done
  [ ${#pending[@]} -eq 0 ]
}

start() {
  ensure_setup
  mkdir -p "$RUN"
  say "Starting LiveKit (Docker)…"
  if ! docker info >/dev/null 2>&1; then
    red "Docker isn't running. Start Docker Desktop (or OrbStack), then run: make start"
    exit 1
  fi
  "${COMPOSE[@]}" up -d livekit >/dev/null 2>&1 || { red "Could not start LiveKit"; exit 1; }
  say "Starting API, agent worker and Studio…"
  local svc
  for svc in "${SERVICES[@]}"; do start_service "$svc" || exit 1; done
  if wait_ready livekit "${SERVICES[@]}"; then
    echo ""
    say "Everything is running. Open $STUDIO_URL in Chrome or Safari."
    echo "  make logs  - follow logs     make status - check     make stop - stop everything"
  else
    echo ""
    red "Something didn't start. Run 'make logs' to see why, or 'make stop' to shut down."
    exit 1
  fi
}

# --- Stop ----------------------------------------------------------------------------------
stop_group() {
  local pid="$1" i
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || return 0
  for i in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
}

stop() {
  say "Stopping API, agent worker and Studio…"
  local svc pid port stray
  for svc in "${SERVICES[@]}"; do
    pid="$(pid_of "$svc")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      stop_group "$pid"
      green "stopped $svc"
    fi
    rm -f "$RUN/$svc.pid"
  done
  # Also stop copies started some other way (make dev, an editor, a preview pane).
  for svc in api studio; do
    port="$(port_for "$svc")"
    stray="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null)"
    if [ -n "$stray" ]; then
      kill $stray 2>/dev/null
      green "stopped $svc (started elsewhere, port $port)"
    fi
  done
  if pkill -f "agent_worker.main" 2>/dev/null; then green "stopped worker (started elsewhere)"; fi

  say "Stopping Docker containers…"
  if docker info >/dev/null 2>&1; then
    "${COMPOSE[@]}" --profile full down >/dev/null 2>&1 && green "LiveKit stopped"
  else
    grey "Docker isn't running"
  fi
}

# Restart one service and leave the rest running. The worker is the usual case: the API and Studio
# reload on file changes, the worker does not.
restart_one() {
  local svc="$1" pid
  case "$svc" in api | worker | studio) ;; *) echo "usage: make restart s=api|worker|studio"; exit 2 ;; esac
  ensure_setup
  mkdir -p "$RUN"
  say "Restarting $svc…"
  pid="$(pid_of "$svc")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then stop_group "$pid"; fi
  rm -f "$RUN/$svc.pid"
  if [ "$svc" = worker ]; then pkill -f "agent_worker.main" 2>/dev/null; sleep 1; fi
  start_service "$svc" || exit 1
  wait_ready "$svc"
}

# --- Status --------------------------------------------------------------------------------
status() {
  say "Services"
  if is_ready livekit; then green "LiveKit      ws://localhost:7880"; else grey "LiveKit      stopped"; fi
  is_ready api && green "API          http://localhost:8787" || grey "API          stopped"
  if pgrep -f "agent_worker.main" >/dev/null; then green "Agent worker running"; else grey "Agent worker stopped"; fi
  is_ready studio && green "Studio       $STUDIO_URL" || grey "Studio       stopped"
  say "Setup"
  [ -f "$ROOT/.env" ] && green ".env present" || red ".env missing (make start creates it)"
  if grep -qE '^(LIVE_MODEL_API_KEY|GEMINI_API_KEY)=.+' "$ROOT/.env" 2>/dev/null; then
    green "Gemini key set (make key tests it)"
  else
    red "No LIVE_MODEL_API_KEY in .env"
  fi
  local t
  for t in node pnpm uv docker; do
    command -v "$t" >/dev/null && green "$t $("$t" --version 2>/dev/null | head -1)" || red "$t not installed"
  done
  docker info >/dev/null 2>&1 || red "Docker isn't running"
}

# --- Logs ----------------------------------------------------------------------------------
logs() {
  local only="${1:-}"
  if [ "$only" = livekit ]; then exec "${COMPOSE[@]}" logs -f livekit; fi
  local files=() svc
  for svc in "${SERVICES[@]}"; do
    if [ -z "$only" ] || [ "$only" = "$svc" ]; then
      [ -f "$RUN/$svc.log" ] && files+=("$RUN/$svc.log")
    fi
  done
  if [ ${#files[@]} -eq 0 ]; then echo "No logs yet. Run: make start"; exit 1; fi
  echo "Following logs (Ctrl-C to stop watching; services keep running)…"
  exec tail -n 40 -F "${files[@]}"
}

# Start, follow the logs here, and stop everything on Ctrl-C.
dev() {
  start || exit 1
  trap 'echo; stop; exit 0' INT TERM
  echo ""
  echo "Showing live logs. Ctrl-C stops everything."
  tail -n 0 -F "$RUN/api.log" "$RUN/worker.log" "$RUN/studio.log" &
  wait
}

case "${1:-}" in
  start) start ;;
  dev) dev ;;
  stop) stop ;;
  restart) if [ -n "${2:-}" ]; then restart_one "$2"; else stop && start; fi ;;
  status) status ;;
  logs) logs "${2:-}" ;;
  *) echo "usage: run.sh start|dev|stop|restart [api|worker|studio]|status|logs [api|worker|studio|livekit]"; exit 2 ;;
esac
