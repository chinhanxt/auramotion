# Giọng đọc: VieNeu-TTS v3 Turbo

AuraMotion dùng [VieNeu-TTS v3 Turbo](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo) cho lồng tiếng (giai đoạn 2): 25 giọng tiếng Việt có sẵn và clone giọng từ audio mẫu 3–8 giây. Giấy phép Apache 2.0, model 0.1B, 48 kHz.

Dự án là MVP đồ án, ít người dùng, nên **chạy CPU là đủ**. GPU chỉ cần khi muốn nhanh hơn.

## Cài (CPU, đã chạy trên máy dev)

```bash
mkdir -p ~/Apps/vieneu-tts && cd ~/Apps/vieneu-tts
python3.12 -m venv .venv
.venv/bin/pip install --default-timeout=120 --retries 10 vieneu "onnxruntime<1.23"
cp <repo>/tools/voice/vieneu_say.py ~/Apps/vieneu-tts/
mkdir -p ~/.local/bin && cat > ~/.local/bin/vieneu-say <<'EOF'
#!/usr/bin/env bash
export PYTHONWARNINGS=ignore HF_HUB_DISABLE_SYMLINKS_WARNING=1
exec "$HOME/Apps/vieneu-tts/.venv/bin/python" "$HOME/Apps/vieneu-tts/vieneu_say.py" "$@"
EOF
chmod +x ~/.local/bin/vieneu-say
```

- `onnxruntime<1.23` là **bắt buộc**: bản 1.23 trở lên chặn file trọng số nằm trong cache Hugging Face (symlink) và báo `External data path escapes model directory`.
- Lần chạy đầu tự tải model (khoảng 3 GB vào `~/.cache/huggingface`).
- Venv khoảng 1,1 GB.

## Gọi từ dự án

Lệnh dùng chung `~/.local/bin/vieneu-say` (bọc `~/Apps/vieneu-tts/vieneu_say.py`):

```bash
vieneu-say --list                                   # liệt kê giọng có sẵn
vieneu-say "Xin chào" -o out.wav                    # giọng mặc định
vieneu-say "Xin chào" -o out.wav --voice "Trúc Ly"  # giọng có sẵn
vieneu-say "Xin chào" -o out.wav --ref mau.wav      # clone từ audio mẫu 3–8 giây
vieneu-say -f kich-ban.txt -o out.wav               # đọc chữ từ file
```

In ra JSON `{"output", "seconds", "elapsed"}`, nên worker gọi qua subprocess rồi đọc kết quả. Mỗi lần gọi mất khoảng 18 giây nạp model; nếu cần nhanh hơn thì giữ một tiến trình Python chạy nền nạp model một lần.

Python API:

```python
from vieneu import Vieneu
tts = Vieneu()                                        # device="auto" | "cuda" | "cpu"
audio = tts.infer(text, voice="Trúc Ly")              # hoặc ref_audio="mau.wav"
tts.add_voice("Giọng của tôi", "mau.wav", save=True)  # lưu giọng clone để gọi bằng tên
tts.save(audio, "out.wav")
```

## Tốc độ đo được (CPU Intel Core 5 210H, 12 luồng)

| Việc | Thời gian xử lý | Audio ra |
|---|---|---|
| Giọng mặc định, fp32 | 46 s | 6,8 s |
| Giọng mặc định, int8 (`Vieneu(precision="int8")`) | 36 s | 6,5 s |
| Clone giọng Adam | 71 s | 6,9 s |
| Câu ngắn, giọng Trúc Ly | 10 s | 1,7 s |

Chất lượng giọng có sẵn và giọng clone: chinhan đã nghe, đạt.

## GPU (chưa làm, để nhớ)

Chưa cài vì lúc đó ổ `/home` hết chỗ. Cần khoảng **5–6 GB trống** và driver NVIDIA hỗ trợ **CUDA 12.8 trở lên** (`nvidia-smi` xem dòng `CUDA Version`).

```bash
cd ~/Apps/vieneu-tts
.venv/bin/pip install --default-timeout=180 --retries 10 \
  torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
.venv/bin/pip install --default-timeout=180 --retries 10 "vieneu[cuda]==3.8.3" "onnxruntime<1.23"
.venv/bin/python -c "import torch; print(torch.cuda.is_available())"   # phải ra True
vieneu-say "Thử GPU" -o gpu.wav --device cuda
```

- Có GPU thì `device="auto"` tự chọn bản PyTorch trên CUDA; không có thì chạy ONNX trên CPU như hiện tại.
- Máy dev có RTX 3050 6 GB. Model 0.1B nên VRAM dư sức, nhưng chạy chung GPU với việc nặng khác (render) thì nên chạy lần lượt.
- Cài hỏng giữa chừng (hết ổ đĩa…) thì gỡ phần dở: `pip uninstall` các gói `nvidia-*`, `torch`, `torchaudio`, `triton`, rồi `pip cache purge`.

## Lưu ý

- Audio mẫu để clone phải là file âm thanh thật. File `.wav` lấy từ repo dùng Git LFS có thể chỉ là con trỏ text (`version https://git-lfs...`), khi đó phải `git lfs pull` hoặc lấy audio từ nguồn khác.
- `infer()` mặc định gắn watermark âm thanh (`apply_watermark=True`), tai người không nghe thấy.
