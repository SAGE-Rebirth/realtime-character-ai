# MetaAvatar — project control.  Run `make` to see the commands.
#
#   make start   start everything (Docker + API + agent worker + Studio) in the background
#   make stop    stop everything
#
# First run: `make start` creates .env, installs dependencies and builds what it needs.

SHELL       := /bin/bash
.DEFAULT_GOAL := help

ROOT        := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
RUN         := $(ROOT)/scripts/run.sh
WORKER_DIR  := $(ROOT)/services/agent-worker
UV_RUN      := cd $(WORKER_DIR) && PYTHONWARNINGS=ignore::SyntaxWarning uv run

# ---------------------------------------------------------------------------------------------------
##@ Everyday

.PHONY: start
start: ## Start everything (Docker, API, agent worker, Studio) in the background
	@$(RUN) start

.PHONY: stop
stop: ## Stop everything (services and Docker)
	@$(RUN) stop

.PHONY: restart
restart: ## Stop, then start again. One service: make restart s=worker (api|worker|studio)
	@$(RUN) restart $(s)

.PHONY: status
status: ## Show what's running and whether setup looks right
	@$(RUN) status

.PHONY: logs
logs: ## Follow logs. One service: make logs s=worker (api|worker|studio|livekit)
	@$(RUN) logs $(s)

.PHONY: open
open: ## Open the playground in your browser
	@open http://localhost:3100/playground

# ---------------------------------------------------------------------------------------------------
##@ Development

.PHONY: dev
dev: ## Like start, but stays in this terminal with live logs; Ctrl-C stops everything
	@$(RUN) dev

.PHONY: key
key: ## Test the Gemini key with one tiny request
	@$(UV_RUN) python -c "from agent_worker.preflight import check_gemini; from agent_worker.settings import load_settings; raise SystemExit(0 if check_gemini(load_settings()) else 1)" && echo "Gemini key works"

.PHONY: install
install: hooks ## Reinstall dependencies and rebuild the protocol package
	pnpm install
	cd $(WORKER_DIR) && uv sync
	pnpm --filter @metaavatar/protocol build

.PHONY: hooks
hooks: ## Turn on the git pre-commit hook (lint + typecheck before each commit)
	@git config core.hooksPath .githooks && echo "Pre-commit hook on (.githooks/pre-commit)"

.PHONY: voices
voices: ## Generate the voice sample clips Studio plays (once; ARGS=--force to redo)
	$(UV_RUN) python $(ROOT)/scripts/voice_previews.py $(ARGS)

.PHONY: protocol
protocol: ## After changing packages/protocol: rebuild it and regenerate the Python models
	pnpm --filter @metaavatar/protocol build
	pnpm --filter @metaavatar/protocol run gen

# ---------------------------------------------------------------------------------------------------
##@ Quality

.PHONY: check
check: typecheck lint test ## Everything below in one go: typecheck, lint, tests (run before committing)
	@printf "\n\033[32mAll checks passed.\033[0m\n"

.PHONY: test
test: _protocol-dist ## Run all tests (TypeScript and Python)
	pnpm -r --filter './packages/*' --filter './services/api' test
	$(UV_RUN) pytest -q

.PHONY: typecheck
typecheck: _protocol-dist ## Typecheck all TypeScript (API, runtime, Studio, protocol)
	pnpm -r typecheck

.PHONY: lint
lint: ## Lint the Python worker and check its formatting (ruff)
	cd $(WORKER_DIR) && uv run ruff check . && uv run ruff format --check .

.PHONY: eval
eval: ## Measure reply time and barge-in against a live agent (needs make start). ARGS="--turns 5"
	$(UV_RUN) python $(ROOT)/evals/latency.py $(ARGS)

.PHONY: fmt
fmt: ## Auto-fix lint issues and format the Python worker
	cd $(WORKER_DIR) && uv run ruff check --fix . && uv run ruff format .

.PHONY: _protocol-dist
_protocol-dist:
	@pnpm --filter @metaavatar/protocol build >/dev/null

# ---------------------------------------------------------------------------------------------------
##@ Cleanup

.PHONY: clean
clean: _not-running ## Remove build output, caches and logs (keeps dependencies and .env)
	rm -rf packages/protocol/dist services/api/dist apps/studio/.next .run
	find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
	cd $(WORKER_DIR) && rm -rf .pytest_cache .ruff_cache .mypy_cache
	find $(WORKER_DIR) -name __pycache__ -type d -not -path '*/.venv/*' -prune -exec rm -rf {} +
	@echo "Clean. Next 'make start' rebuilds what it needs."

.PHONY: reset
reset: stop clean ## Clean, plus remove node_modules, the Python venv and container data; keeps .env
	rm -rf node_modules apps/*/node_modules packages/*/node_modules services/api/node_modules
	rm -rf $(WORKER_DIR)/.venv infra/docker/data
	@echo "Reset. Next 'make start' reinstalls everything."

.PHONY: _not-running
_not-running:
	@if lsof -ti tcp:8787,3100 -sTCP:LISTEN >/dev/null 2>&1 || pgrep -f agent_worker.main >/dev/null; then \
		echo "Services are running. Run 'make stop' first (clean would delete files they are using)."; exit 1; fi

# ---------------------------------------------------------------------------------------------------
.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<command>\033[0m\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@echo ""
