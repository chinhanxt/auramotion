"""VieNeu-TTS v3 Turbo dùng chung cho mọi dự án trên máy.

  vieneu-say "Xin chào" -o out.wav                    giọng mặc định
  vieneu-say "Xin chào" -o out.wav --voice "Trúc Ly"  giọng có sẵn
  vieneu-say "Xin chào" -o out.wav --ref mau.wav      clone từ audio mẫu 3–8 giây
  vieneu-say --list                                   liệt kê giọng có sẵn
  vieneu-say -f script.txt -o out.wav                 đọc chữ từ file
  vieneu-say -f script.txt -o out.wav --segments seg.json
                                                      mỗi dòng 1 câu, ghi mốc giờ từng câu (làm phụ đề)

In ra JSON {"output", "seconds", "elapsed"} để dự án khác gọi qua subprocess.
"""
import argparse
import json
import sys
import time

GAP = 0.25  # giây lặng giữa hai câu khi dùng --segments


def main() -> int:
    ap = argparse.ArgumentParser(prog="vieneu-say")
    ap.add_argument("text", nargs="?")
    ap.add_argument("-f", "--file", help="đọc chữ từ file UTF-8")
    ap.add_argument("-o", "--output", help="file .wav xuất ra")
    ap.add_argument("--voice", help="tên giọng có sẵn (xem --list)")
    ap.add_argument("--ref", help="audio mẫu để clone giọng (3–8 giây)")
    ap.add_argument("--device", default="auto", help="auto | cuda | cpu")
    ap.add_argument("--list", action="store_true", help="liệt kê giọng có sẵn")
    ap.add_argument("--segments", help="mỗi dòng là 1 câu; ghi JSON [{text,start,end}] ra file này")
    a = ap.parse_args()

    from vieneu import Vieneu

    tts = Vieneu(device=a.device)

    if a.list:
        for v in tts.list_preset_voices():
            print(v[0] if isinstance(v, (list, tuple)) else v)
        return 0

    text = open(a.file, encoding="utf-8").read() if a.file else a.text
    if not text or not a.output:
        ap.error("cần chữ (text hoặc -f) và -o")

    kw = {}
    if a.ref:
        kw["ref_audio"] = a.ref
    elif a.voice:
        kw["voice"] = tts.resolve_voice_name(a.voice)

    t = time.time()
    if a.segments:
        import numpy as np
        sr = tts.sample_rate
        gap = np.zeros(int(GAP * sr), dtype=np.float32)
        parts, segs, pos = [], [], 0.0
        for line in (s.strip() for s in text.splitlines()):
            if not line:
                continue
            wav = np.asarray(tts.infer(line, **kw), dtype=np.float32).reshape(-1)
            segs.append({"text": line, "start": round(pos, 3), "end": round(pos + len(wav) / sr, 3)})
            parts += [wav, gap]
            pos += len(wav) / sr + GAP
        audio = np.concatenate(parts[:-1]) if parts else np.zeros(1, dtype=np.float32)
        with open(a.segments, "w", encoding="utf-8") as f:
            json.dump(segs, f, ensure_ascii=False, indent=1)
    else:
        audio = tts.infer(text, **kw)
    tts.save(audio, a.output)
    print(json.dumps({"output": a.output, "seconds": round(len(audio) / tts.sample_rate, 2),
                      "elapsed": round(time.time() - t, 2)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
