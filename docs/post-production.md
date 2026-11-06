# Hậu kỳ (ghép video) — bản MVP

Một script Python duy nhất gọi ffmpeg: [`tools/post/assemble.py`](../tools/post/assemble.py). Không timeline, không agent dựng, không HyperFrames.

## Đã học từ đâu, giữ gì, bỏ gì

| Dự án | Cách làm | AuraMotion |
|---|---|---|
| em-bong (FlowFit) | `edit.json` + OpenReel timeline + agent dựng + HyperFrames + Whisper + auto-editor + con trỏ diễn hoạt | **Bỏ** (quá nặng cho MVP). **Giữ** ý: đưa clip khác cỡ về cùng cỡ (Muse trả lúc 2160×3840, lúc 720×1280), master −14 LUFS, nhạc thấp hơn giọng và tự hạ khi có thoại |
| sesame-studio | ffmpeg concat + `loudnorm`, nhạc nền `sidechaincompress`, phụ đề SRT đốt vào hình (`subtitles=`) | **Giữ** gần như nguyên |
| Thêm của mình | Phụ đề lấy thẳng mốc giờ từng câu VieNeu đọc, không cần Whisper; ảnh tĩnh thành clip zoom chậm | |

## Luồng

1. Chuẩn hóa từng clip: cắt cho đầy khung (`scale…increase,crop`), 30 fps, H.264, luôn có track tiếng (clip không tiếng thì chèn im lặng). Ảnh → zoom chậm 1.00 → 1.10.
2. Nối bằng concat demuxer (`-c copy`, không encode lại).
3. Giọng: `vieneu-say -f script.txt --segments seg.json`, mỗi dòng 1 câu, nạp model 1 lần, ra wav + mốc giờ từng câu.
4. Trộn tiếng trong 1 lần ffmpeg:
   - Tiếng clip Muse: tắt mặc định (`clip_audio_db: null`), muốn giữ thì cho số dB.
   - Giọng: bắt đầu sau 0,3 s.
   - Nhạc: lặp cho đủ dài, −14 dB, `sidechaincompress` hạ nhạc khi có giọng, fade out 1 s.
   - `loudnorm I=-14 TP=-1.5`.
5. Hình: giọng dài hơn video thì giữ khung cuối (`tpad clone`); đốt phụ đề (Roboto đậm, viền đen, câu dài chia dòng ≤ 7 chữ); fade in 0,3 s / out 0,4 s.
6. Xuất H.264 CRF 20 + AAC 192k, `+faststart`.

## Dùng

```bash
python3 tools/post/assemble.py spec.json
```

```json
{
  "aspect": "9:16",
  "clips": [
    {"type": "image", "src": "anh.webp", "duration": 3},
    {"type": "video", "src": "clip.mp4", "in": 0, "out": 5}
  ],
  "clip_audio_db": null,
  "voice": {"lines": ["Câu 1.", "Câu 2."], "voice": "Trúc Ly"},
  "music": {"src": "nhac.mp3", "volume_db": -14},
  "subtitles": true,
  "out": "final.mp4"
}
```

`voice` có thể dùng `"ref": "mau.wav"` để clone giọng; bỏ `voice` thì không lồng tiếng (và không có phụ đề); bỏ `music` thì không nhạc. In ra `{"output", "duration", "elapsed"}`, lỗi in `{"error"}` và thoát mã 2, nên worker gọi qua subprocess.

## Đã chạy thử (06/11)

Ảnh Muse 3 s + clip video Muse 5 s + 3 câu giọng Trúc Ly + nhạc `music-funky-house` (CC0, từ thư viện em-bong) + phụ đề:

- Ra 1080×1920, 30 fps, 8,0 s, **−14,2 LUFS**.
- Mất 103 s, phần lớn là VieNeu chạy CPU (xem [voice-vieneu.md](voice-vieneu.md)); phần ffmpeg vài giây.
- Phụ đề tiếng Việt đủ dấu, nằm trong vùng an toàn 9:16.

## Nhạc nền

Thư viện CC0 của em-bong (`flowfit/assets/audio/cc0/music`, 15 bài, 30 MB, dùng thương mại không cần ghi nguồn). Khi đưa vào AuraMotion: chép 4–6 bài hợp quảng cáo vào `public/music/` kèm `LICENSES.md`.

## Đưa vào app (giai đoạn 2)

- Bảng `projects`: danh sách job ảnh/video đã xong + lời thoại + giọng + nhạc → worker build spec → chạy `assemble.py` → upload R2.
- Credit: tính theo số câu lồng tiếng (VieNeu chạy CPU, chậm nhất trong cả luồng).
- Để sau: chuyển cảnh `xfade`, chữ hook đầu video, CTA cuối, tách nền.
