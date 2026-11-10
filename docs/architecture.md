# Kiến Trúc Thư Mục

**Stack:** Next.js 15 (App Router, TypeScript) · PostgreSQL + Prisma · Redis + BullMQ · lưu file trên ổ máy.

1 repo, 1 app Next.js, 1 worker. Chạy trên **1 máy** (MVP đồ án): Postgres + Redis bằng docker-compose; app, worker và muse2api chạy native, vì worker cần `agy`, `codex`, `vieneu-say`, `ffmpeg` đã đăng nhập / cài sẵn trên máy.

```
Người dùng ──► Next.js app ──► Redis (BullMQ) ──► Worker ─┬─► muse2api (MUSE): ảnh, video
                   │                                       ├─► agy / codex CLI: viết prompt, ảnh
                   │                                       └─► tools/post/assemble.py: VieNeu + ffmpeg
                   └──────── PostgreSQL ◄──────────────────┴──► STORAGE_DIR (file kết quả, /media/...)
Admin ──► /admin (trong cùng app)
```

```
auramotion/
├── docs/                     plan, kiến trúc, voice, hậu kỳ, plan triển khai (superpowers/plans)
├── prisma/                   schema.prisma, migrations, seed.ts (gói, engine, preset, nhạc mặc định)
├── public/
│   ├── presets/              Ảnh demo của preset
│   └── music/                Nhạc nền CC0 + LICENSES.md
├── scripts/                  muse-keepalive.sh, muse2api-mock.sh, start-all.sh
├── tools/post/               assemble.py — ghép video bằng ffmpeg
├── src/
│   ├── app/
│   │   ├── (auth)/           login, register, forgot-password, reset-password
│   │   ├── (user)/
│   │   │   ├── studio/image  Tạo ảnh (chọn engine MUSE / agy / codex)
│   │   │   ├── studio/video  Tạo video (MUSE)
│   │   │   ├── studio/edit   Ghép video: clip + lời thoại + giọng + nhạc + phụ đề
│   │   │   ├── library       Thư viện kết quả
│   │   │   ├── credits       Số dư, lịch sử Credit & thanh toán
│   │   │   └── profile       Hồ sơ
│   │   ├── pricing/          Bảng giá (công khai)
│   │   ├── media/[...key]    Phục vụ file trong STORAGE_DIR
│   │   ├── admin/            users · models · credit-rules · plans · presets · music · jobs · payments · settings
│   │   └── api/              auth · jobs · uploads · credits · payments(/webhook) · ai/prompt · voices · catalog · admin
│   ├── components/           ui · layout · studio · library · admin
│   ├── server/               Logic phía server (dùng chung app + worker)
│   │   ├── ai/               gateway (agy | codex | Muse chat, dự phòng + health), template skill, sửa JSON
│   │   ├── services/         credit, pricing, plan, account, job, story, assemble, catalog, payment, admin, admin-ops, settings
│   │   └── engines/          muse (muse2api), muse-scheduler (slot chat phụ), muse-block, media (ffprobe), cli, agy, codex, prompt-writer, voice, assemble
│   ├── lib/                  db, redis, queue, events (pub/sub), sse, storage (ổ đĩa), mail, auth, errors, http
│   └── types/
├── worker/                   `npm run worker`: 4 hàng đợi muse · cli · post · story + cron
├── tests/
├── .env.example
└── README.md
```

## Quy tắc
- `app/` chỉ nhận request và trả về. Logic nghiệp vụ nằm trong `server/services`.
- Mọi thay đổi Credit đi qua `server/services/credit`, không ghi thẳng vào DB ở chỗ khác.
- Chỉ `server/engines/` được gọi engine (muse2api, CLI, VieNeu, ffmpeg). Service gọi engine qua `getMuse()` và `getFileEngine(provider)`.
- Mỗi lệnh CLI (agy / codex) chạy trong thư mục tạm riêng, xong là xóa cả thư mục và phiên — không để lại session.
- `worker/` import `src/server` và `src/lib`, không import gì từ `app/` hay `components/`.

## Nhánh
- `main`: bản ổn định. Chỉ merge vào qua PR.
- `dev1`, `dev2`: nhánh phát triển song song, rẽ từ `main`. Chỉ push khi chinhan bảo.
