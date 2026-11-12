# MetaAvatar — project control.  Run `make` or `make help` to see every target.

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT        := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WORKER_DIR  := $(ROOT)/services/agent-worker
COMPOSE     := docker compose -f $(ROOT)/infra/docker/compose.yaml
UV_RUN      := cd $(WORKER_DIR) && PYTHONWARNINGS=ignore::SyntaxWarning uv run
STUDIO_URL  := http://localhost:3100/playground
API_URL     := http://localhost:8787

# ---------------------------------------------------------------------------------------------------
##@ Setup

.PHONY: setup
setup: env install protocol infra-up ## First-time setup: .env, dependencies, protocol build, LiveKit
	@echo ""
	@echo "Setup done. Add LIVE_MODEL_API_KEY to .env if you haven't, then run: make dev"

.PHONY: env
env: ## Create .env from .env.example (never overwrites an existing .env)
	@if [ -f .env ]; then echo ".env already exists, leaving it alone"; else cp .env.example .env && echo "Created .env (add LIVE_MODEL_API_KEY)"; fi

.PHONY: install
install: ## Install Node and Python dependencies
	pnpm install
	cd $(WORKER_DIR) && uv sync

.PHONY: protocol
protocol: ## Build the shared protocol package
	pnpm --filter @metaavatar/protocol build

.PHONY: gen-protocol
gen-protocol: ## Regenerate Python protocol models from the Zod schemas
	pnpm --filter @metaavatar/protocol run gen

.PHONY: doctor
doctor: ## Check tools, ports, LiveKit and the Gemini key (prints no secrets)
	@ok() { printf "  \033[32m✓\033[0m %s\n" "$$1"; }; bad() { printf "  \033[31m✗\033[0m %s\n" "$$1"; }; \
	echo "Tools:"; \
	for t in node pnpm uv docker; do command -v $$t >/dev/null && ok "$$t $$($$t --version 2>/dev/null | head -1)" || bad "$$t not found"; done; \
	echo "Config:"; \
	[ -f .env ] && ok ".env present" || bad ".env missing (run: make env)"; \
	if grep -qE '^LIVE_MODEL_API_KEY=.+' .env 2>/dev/null || [ -n "$$LIVE_MODEL_API_KEY$$GEMINI_API_KEY" ]; then ok "Gemini key configured"; else bad "No LIVE_MODEL_API_KEY in .env"; fi; \
	echo "Services:"; \
	curl -s -o /dev/null --max-time 2 http://localhost:7880 && ok "LiveKit on :7880" || bad "LiveKit not running (run: make infra-up)"; \
	curl -s --max-time 2 $(API_URL)/health | grep -q ok && ok "API on :8787" || echo "  - API not running"; \
	curl -s -o /dev/null --max-time 2 http://localhost:3100 && ok "Studio on :3100" || echo "  - Studio not running"; \
	pgrep -f "agent_worker.main" >/dev/null && ok "Agent worker running" || echo "  - Agent worker not running"

.PHONY: check-key
check-key: ## Test the Gemini key with one tiny request
	$(UV_RUN) python -c "from agent_worker.preflight import check_gemini; from agent_worker.settings import load_settings; raise SystemExit(0 if check_gemini(load_settings()) else 1)"

# ---------------------------------------------------------------------------------------------------
##@ Run

.PHONY: dev
dev: infra-up protocol ## Run LiveKit + API + agent worker + Studio together (Ctrl-C stops all)
	@echo "Starting API, agent worker and Studio. Open $(STUDIO_URL) in Chrome or Safari."
	@trap 'kill 0' INT TERM EXIT; \
	( $(MAKE) --no-print-directory api    2>&1 | sed -u 's/^/[api]    /' ) & \
	( $(MAKE) --no-print-directory worker 2>&1 | sed -u 's/^/[worker] /' ) & \
	( $(MAKE) --no-print-directory studio 2>&1 | sed -u 's/^/[studio] /' ) & \
	wait

.PHONY: api
api: ## Run the session API (http://localhost:8787)
	pnpm --filter @metaavatar/api dev

.PHONY: worker
worker: ## Run the Gemini Live agent worker
	$(UV_RUN) python -m agent_worker.main start

.PHONY: studio
studio: ## Run Studio (http://localhost:3100/playground)
	pnpm --filter @metaavatar/studio dev

.PHONY: open
open: ## Open the playground in your default browser
	open $(STUDIO_URL)

# ---------------------------------------------------------------------------------------------------
##@ Infrastructure (Docker)

.PHONY: infra-up
infra-up: ## Start the local LiveKit server
	$(COMPOSE) up -d livekit

.PHONY: infra-full
infra-full: ## Start LiveKit plus Postgres, Redis and MinIO
	$(COMPOSE) --profile full up -d

.PHONY: infra-down
infra-down: ## Stop all local containers
	$(COMPOSE) --profile full down

.PHONY: logs
logs: ## Follow LiveKit server logs
	$(COMPOSE) logs -f livekit

.PHONY: ps
ps: ## Show local containers
	$(COMPOSE) --profile full ps

# ---------------------------------------------------------------------------------------------------
##@ Quality

.PHONY: check
check: typecheck lint test ## Typecheck, lint and test everything

.PHONY: test
test: protocol ## Run all tests (TypeScript + Python)
	pnpm -r --filter './packages/*' --filter './services/api' test
	$(UV_RUN) pytest -q

.PHONY: typecheck
typecheck: protocol ## Typecheck all TypeScript packages
	pnpm -r typecheck

.PHONY: lint
lint: ## Lint the Python worker
	cd $(WORKER_DIR) && uv run ruff check .

.PHONY: fmt
fmt: ## Auto-fix Python lint issues and format
	cd $(WORKER_DIR) && uv run ruff check --fix . && uv run ruff format .

# ---------------------------------------------------------------------------------------------------
##@ Cleanup

.PHONY: stop
stop: ## Stop dev servers started outside `make dev` (API, Studio, worker)
	-@pkill -f "agent_worker.main" && echo "stopped worker" || true
	-@lsof -ti tcp:8787 | xargs kill 2>/dev/null && echo "stopped api" || true
	-@lsof -ti tcp:3100 | xargs kill 2>/dev/null && echo "stopped studio" || true

.PHONY: clean
clean: ## Remove build output (keeps dependencies and .env)
	rm -rf packages/protocol/dist apps/studio/.next
	find services/agent-worker -name __pycache__ -type d -prune -exec rm -rf {} +

.PHONY: distclean
distclean: clean infra-down ## Also remove node_modules, the Python venv and local container data
	rm -rf node_modules apps/*/node_modules packages/*/node_modules services/api/node_modules
	rm -rf $(WORKER_DIR)/.venv infra/docker/data

# ---------------------------------------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@echo ""
