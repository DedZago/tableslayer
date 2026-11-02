HOST := ./containers/host.sh
DATA_ROOT := $(shell sed -n 's/^DATA_ROOT=//p' .env 2>/dev/null | tr -d '"')
LAN_HOST := $(shell sed -n 's/^LAN_HOST=//p' .env 2>/dev/null)
DEV_APP_PORT := $(or $(shell sed -n 's/^DEV_APP_PORT=//p' .env 2>/dev/null),5174)
DEV_DOCS_PORT := $(or $(shell sed -n 's/^DEV_DOCS_PORT=//p' .env 2>/dev/null),5173)
SENTINEL := map/pirateking-30x60.jpg

.PHONY: dev release stop logs-dev logs-release backup-release help

help:
	@echo "make dev      build and start the development stack (http://$(LAN_HOST):$(DEV_APP_PORT))"
	@echo "make release  build and start the release stack (http://$(LAN_HOST):8080)"
	@echo "make stop     stop both stacks"
	@echo "make backup-release  archive the release data folder"

.env:
	@echo "Missing .env. Run once: $(HOST) setup /absolute/data/path LAN_IP_OR_HOSTNAME" >&2
	@exit 1

dev: .env
	-$(HOST) down development
	@test -f "$(DATA_ROOT)/development/assets/$(SENTINEL)" || $(HOST) assets development
	$(HOST) up development
	@echo "App: http://$(LAN_HOST):$(DEV_APP_PORT)  Docs: http://$(LAN_HOST):$(DEV_DOCS_PORT)"
	$(HOST) logs development

release: .env
	-$(HOST) down release
	@test -f "$(DATA_ROOT)/release/assets/$(SENTINEL)" || $(HOST) assets release
	$(HOST) up release
	@echo "App: http://$(LAN_HOST):8080"

stop: .env
	-$(HOST) down development
	-$(HOST) down release

logs-dev: .env
	$(HOST) logs development

logs-release: .env
	$(HOST) logs release

backup-release: .env
	$(HOST) backup release
