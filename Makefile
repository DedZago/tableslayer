HOST := ./containers/host.sh
DATA_ROOT := $(shell sed -n 's/^DATA_ROOT=//p' .env 2>/dev/null | tr -d '"')
LAN_HOST := $(shell sed -n 's/^LAN_HOST=//p' .env 2>/dev/null)
SENTINEL := map/pirateking-30x60.jpg

.PHONY: dev release stop logs-dev logs-release backup-release help

help:
	@echo "make dev      build, migrate and start the development stack (http://$(LAN_HOST):5174)"
	@echo "make release  build, migrate and start the release stack (https://$(LAN_HOST):8443)"
	@echo "make stop     stop both stacks"
	@echo "make backup-release  archive the release data folder"

.env:
	@echo "Missing .env. Run once: $(HOST) setup /absolute/data/path LAN_IP_OR_HOSTNAME" >&2
	@exit 1

dev: .env
	-$(HOST) down development
	$(HOST) migrate development
	@test -f "$(DATA_ROOT)/development/assets/$(SENTINEL)" || $(HOST) assets development
	$(HOST) up development
	@echo "App: http://$(LAN_HOST):5174  Docs: http://$(LAN_HOST):5173"
	$(HOST) logs development

release: .env
	-$(HOST) down release
	$(HOST) migrate release
	@test -f "$(DATA_ROOT)/tls/server.crt" || $(HOST) tls
	@test -f "$(DATA_ROOT)/release/assets/$(SENTINEL)" || $(HOST) assets release
	$(HOST) up release
	@echo "App: https://$(LAN_HOST):8443  CA certificate: $(DATA_ROOT)/tls/ca.crt"

stop: .env
	-$(HOST) down development
	-$(HOST) down release

logs-dev: .env
	$(HOST) logs development

logs-release: .env
	$(HOST) logs release

backup-release: .env
	$(HOST) backup release
