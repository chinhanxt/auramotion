#!/usr/bin/env python3
"""Hậu kỳ MVP: ghép clip video / ảnh + giọng VieNeu + nhạc nền + phụ đề thành 1 MP4, chỉ bằng ffmpeg.

Dùng:  python3 tools/post/assemble.py spec.json
Spec (JSON):
{
  "aspect": "9:16",                       # 9:16 | 16:9 | 1:1
  "clips": [
    {"type": "video", "src": "a.mp4", "in": 0, "out": 5},
    {"type": "image", "src": "b.webp", "duration": 3}     # ảnh tĩnh -> zoom chậm
  ],
  "clip_audio_db": null,                  # null = tắt tiếng clip (Muse tự sinh tiếng); số = giữ, chỉnh dB
  "voice": {"lines": ["Câu 1.", "Câu 2."], "voice": "Trúc Ly"},   # hoặc "ref": "mau.wav"; bỏ trống = không lồng tiếng
  "music": {"src": "nhac.mp3", "volume_db": -14},                 # tự hạ khi có giọng
  "subtitles": true,                      # phụ đề lấy từ voice.lines, đúng mốc giờ từng câu
  "out": "final.mp4",
  "tmp_dir": null                         # thư mục chứa file làm việc tạm; null = mặc định của hệ thống
}
Giọng đọc gọi `$VIENEU_BIN` (mặc định `vieneu-say` trong PATH).
In ra JSON {"output", "duration", "elapsed"}.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}
FPS = 30
VOICE_DELAY = 0.3          # giây trước khi giọng bắt đầu
TAIL = 0.6                 # giây giữ hình sau câu cuối
WORDS_PER_CAPTION = 7      # câu dài thì chia nhiều dòng phụ đề
SUB_STYLE = ("FontName=Roboto,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
             "BorderStyle=1,Outline=1.6,Shadow=0,Alignment=2,MarginV={margin}")


class AssembleError(Exception):
    pass


def run(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise AssembleError(f"{Path(cmd[0]).name} lỗi: {p.stderr.strip()[-600:]}")
    return p.stdout


def duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(out.strip() or 0)


def has_audio(path: Path) -> bool:
    out = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0",
               str(path)])
    return bool(out.strip())


def normalize_clip(clip: dict, w: int, h: int, dest: Path) -> None:
    """Đưa mọi clip về cùng cỡ / fps / codec, luôn có 1 track tiếng (im lặng nếu không có) để nối bằng concat."""
    fill = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest"]
    src = Path(clip["src"])
    if clip["type"] == "image":
        dur = float(clip.get("duration", 3))
        frames = int(dur * FPS)
        zoom = (f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,crop={w * 2}:{h * 2},"
                f"zoompan=z='min(zoom+0.0008,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d={frames}:s={w}x{h}:fps={FPS},setsar=1")
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-f", "lavfi", "-t", f"{dur}",
             "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", f"[0:v]{zoom}[v]", "-map", "[v]", "-map", "1:a",
             "-t", f"{dur}", *enc, str(dest)])
        return
    t_in = float(clip.get("in", 0))
    t_out = clip.get("out")
    cut = ["-ss", f"{t_in}"] + (["-to", f"{float(t_out)}"] if t_out is not None else [])
    if has_audio(src):
        run(["ffmpeg", "-y", "-v", "error", *cut, "-i", str(src), "-vf", fill, "-map", "0:v:0", "-map", "0:a:0",
             *enc, str(dest)])
    else:
        run(["ffmpeg", "-y", "-v", "error", *cut, "-i", str(src), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
             "-vf", fill, "-map", "0:v:0", "-map", "1:a", *enc, str(dest)])


def concat(parts: list[Path], dest: Path, tmp: Path) -> None:
    lst = tmp / "concat.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(dest)])


def make_voice(voice: dict, tmp: Path) -> tuple[Path, list[dict]]:
    """Đọc từng câu bằng VieNeu (1 lần nạp model), trả file wav + mốc giờ từng câu."""
    script = tmp / "voice.txt"
    script.write_text("\n".join(voice["lines"]), encoding="utf-8")
    wav, seg = tmp / "voice.wav", tmp / "voice-seg.json"
    cmd = [os.environ.get("VIENEU_BIN") or shutil.which("vieneu-say") or "vieneu-say", "-f", str(script), "-o", str(wav), "--segments", str(seg)]
    if voice.get("ref"):
        cmd += ["--ref", voice["ref"]]
    elif voice.get("voice"):
        cmd += ["--voice", voice["voice"]]
    run(cmd)
    return wav, json.loads(seg.read_text(encoding="utf-8"))


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(segments: list[dict], offset: float, dest: Path) -> None:
    """Câu dài chia thành dòng ≤ WORDS_PER_CAPTION chữ, thời gian chia theo số ký tự."""
    rows = []
    for s in segments:
        words = s["text"].split()
        chunks = [" ".join(words[i:i + WORDS_PER_CAPTION]) for i in range(0, len(words), WORDS_PER_CAPTION)] or [""]
        total = sum(len(c) for c in chunks) or 1
        t = s["start"]
        for c in chunks:
            d = (s["end"] - s["start"]) * len(c) / total
            rows.append((t + offset, t + d + offset, c))
            t += d
    dest.write_text("".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{c}\n\n" for i, (a, b, c) in enumerate(rows, 1)),
                    encoding="utf-8")


def assemble(spec: dict) -> dict:
    t0 = time.time()
    w, h = SIZES[spec.get("aspect", "9:16")]
    out = Path(spec["out"]).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if not spec.get("clips"):
        raise AssembleError("spec không có clip nào")

    with tempfile.TemporaryDirectory(prefix="aura-post-", dir=spec.get("tmp_dir")) as d:
        tmp = Path(d)
        parts = []
        for i, clip in enumerate(spec["clips"]):
            p = tmp / f"clip{i:02d}.mp4"
            normalize_clip(clip, w, h, p)
            parts.append(p)
        base = tmp / "base.mp4"
        concat(parts, base, tmp)
        video_len = duration(base)

        voice = spec.get("voice") or {}
        segments, voice_wav = [], None
        if voice.get("lines"):
            voice_wav, segments = make_voice(voice, tmp)
        voice_end = (segments[-1]["end"] + VOICE_DELAY + TAIL) if segments else 0.0
        total = max(video_len, voice_end)

        inputs = ["-i", str(base)]
        fa, mix = [], []
        if spec.get("clip_audio_db") is not None:
            fa.append(f"[0:a]volume={float(spec['clip_audio_db'])}dB,apad[clip]")
            mix.append("[clip]")
        if voice_wav:
            inputs += ["-i", str(voice_wav)]
            ms = int(VOICE_DELAY * 1000)
            fa.append(f"[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms},apad,asplit=2[vo][sc]")
            mix.append("[vo]")
        music = spec.get("music") or {}
        if music.get("src"):
            idx = len(inputs) // 2
            inputs += ["-stream_loop", "-1", "-i", music["src"]]
            chain = (f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume={float(music.get('volume_db', -14))}dB,"
                     f"atrim=0:{total:.3f},afade=t=out:st={max(total - 1.0, 0):.3f}:d=1")
            if voice_wav:
                fa.append(f"{chain}[mu];[mu][sc]sidechaincompress=threshold=0.04:ratio=6:attack=80:release=400[md]")
            else:
                fa.append(f"{chain}[md]")
            mix.append("[md]")
        elif voice_wav:
            fa.append("[sc]anullsink")

        vf = f"[0:v]tpad=stop_mode=clone:stop_duration={max(total - video_len, 0) + 0.1:.3f},trim=0:{total:.3f},setpts=PTS-STARTPTS"
        if spec.get("subtitles") and segments:
            srt = tmp / "subs.srt"
            write_srt(segments, VOICE_DELAY, srt)
            margin = 70 if h > w else 20  # 9:16: tránh vùng nút / caption của TikTok, Reels
            vf += f",subtitles={srt.as_posix()}:force_style='{SUB_STYLE.format(margin=margin)}'"
        vf += f",fade=t=in:st=0:d=0.3,fade=t=out:st={max(total - 0.4, 0):.3f}:d=0.4[v]"

        if mix:
            fa.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=longest,"
                      f"atrim=0:{total:.3f},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]")
            amap = ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
        else:
            amap = ["-an"]
        run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join([vf, *fa]), "-map", "[v]", *amap,
             "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
             "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)])

    return {"output": str(out), "duration": round(duration(out), 2), "elapsed": round(time.time() - t0, 1)}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 1
    try:
        print(json.dumps(assemble(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))), ensure_ascii=False))
        return 0
    except AssembleError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
