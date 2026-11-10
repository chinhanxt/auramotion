# AuraMotion — lệnh chạy nhanh trên 1 máy.
#   make dev      chạy chế độ phát triển (next dev, sửa code tự tải lại) + worker + muse2api. Ctrl+C dừng app + worker.
#   make start    bản build (nhanh, nhẹ RAM) chạy nền: muse2api + app + worker
#   make stop     dừng hết (muse2api, app, worker)
#   make restart  build lại rồi chạy lại bản nền
#   make status   xem dịch vụ nào đang chạy · make logs  theo dõi log
#   make setup    lần đầu: cài gói, tạo DB, dữ liệu mẫu
#   make test     chạy test · make check  kiểm kiểu TypeScript
#   make url      in địa chỉ mở trên điện thoại / máy khác cùng mạng

SHELL := /bin/bash
.DEFAULT_GOAL := help
PORT ?= $(shell grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000)
DEV_PORT ?= $(PORT)
LAN_IP := $(shell ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($$i=="src") print $$(i+1)}')
# Lệnh nặng chạy lần lượt (máy từng sập khi chạy song song)
HEAVY := flock /tmp/auramotion-heavy.lock

.PHONY: help dev start stop restart status logs build setup infra migrate seed muse test check url

help:
	@sed -n '2,10p' Makefile | sed 's/^# //'

## Postgres + Redis (docker)
infra:
	@docker compose up -d --wait >/dev/null && echo "✓ Postgres + Redis"

migrate: infra
	@$(HEAVY) npx prisma migrate deploy >/dev/null && echo "✓ DB đã cập nhật"

seed: migrate
	@$(HEAVY) npm run -s db:seed

muse:
	@bash scripts/muse2api.sh start

setup:
	npm ci
	@[ -f .env ] || { cp .env.example .env; echo "→ Đã tạo .env, hãy điền giá trị rồi chạy lại make setup"; exit 1; }
	@$(MAKE) --no-print-directory seed

## Chế độ phát triển: next dev (tự tải lại khi sửa code) + worker. Ctrl+C dừng cả hai.
dev: migrate muse
	@bash scripts/svc.sh stop app >/dev/null 2>&1 || true
	@bash scripts/svc.sh stop worker >/dev/null 2>&1 || true
	@echo "→ AuraMotion (dev): http://localhost:$(DEV_PORT)   ·   cùng mạng: http://$(LAN_IP):$(DEV_PORT)"
	@echo "→ Admin: http://localhost:$(DEV_PORT)/admin   ·   Ctrl+C để dừng"
	@trap 'kill 0' INT TERM EXIT; \
	  npm run -s worker 2>&1 | sed -u 's/^/[worker] /' & \
	  NODE_OPTIONS=--max-old-space-size=2048 npx next dev -H 0.0.0.0 -p $(DEV_PORT) 2>&1 | sed -u 's/^/[app] /'; \
	  wait

## Bản build chạy nền (dùng hằng ngày, nhẹ hơn dev)
build:
	@$(HEAVY) npx tsc --noEmit && echo "✓ TypeScript"
	@NODE_OPTIONS=--max-old-space-size=2560 $(HEAVY) npx next build > data/logs/build.log 2>&1 \
	  && echo "✓ Build xong" || { tail -30 data/logs/build.log; exit 1; }

start: migrate
	@[ -f .next/BUILD_ID ] || $(MAKE) --no-print-directory build
	@bash scripts/svc.sh start
	@$(MAKE) --no-print-directory url

stop:
	@bash scripts/svc.sh stop

restart: build
	@bash scripts/svc.sh restart app
	@bash scripts/svc.sh restart worker
	@$(MAKE) --no-print-directory url

status:
	@bash scripts/svc.sh status

logs:
	@mkdir -p data/logs && tail -n 30 -F data/logs/app.log data/logs/worker.log data/logs/muse2api.log

test: infra
	@$(HEAVY) npx vitest run

check:
	@$(HEAVY) npx tsc --noEmit && echo "✓ TypeScript sạch"

url:
	@echo "→ AuraMotion: http://localhost:$(PORT)   ·   cùng mạng: http://$(LAN_IP):$(PORT)   ·   Admin: /admin"
