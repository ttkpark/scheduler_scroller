# -*- coding: utf-8 -*-
"""
EasyOCR 서버: Node.js child_process에서 stdin/stdout JSON 프로토콜로 통신
stdout을 utf-8로 강제 설정하여 Windows cp949 인코딩 문제 방지
"""
import sys
import json
import os

# 리소스가 적은 환경에서 CPU/메모리 사용량을 줄이기 위한 설정
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

# Windows에서 cp949 문제 방지 - stdout/stderr를 utf-8로 강제
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

reader = None


def init_reader(languages):
    global reader
    import easyocr
    reader = easyocr.Reader(languages, gpu=False, verbose=False)
    return {"status": "success", "message": "Reader initialized"}


def read_text(image_path):
    if reader is None:
        return {"status": "error", "message": "Reader not initialized"}
    if not os.path.exists(image_path):
        return {"status": "error", "message": f"File not found: {image_path}"}
    try:
        result = reader.readtext(image_path)
        return {
            "status": "success",
            "data": [
                {
                    "bbox": [[int(c) for c in pt] for pt in bbox],
                    "text": text,
                    "confidence": float(conf),
                }
                for (bbox, text, conf) in result
            ],
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def process_command(line):
    try:
        req = json.loads(line)
        cmd = req.get("cmd")
        if cmd == "init":
            return init_reader(req.get("languages", ["ko", "en"]))
        elif cmd == "read_text":
            return read_text(req.get("path", ""))
        elif cmd == "close":
            return {"status": "success"}
        else:
            return {"status": "error", "message": f"Unknown command: {cmd}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            result = process_command(line)
            out = json.dumps(result, ensure_ascii=False)
            sys.stdout.write(out + "\n")
            sys.stdout.flush()
            if json.loads(line).get("cmd") == "close":
                break
        except Exception as e:
            err = json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False)
            sys.stdout.write(err + "\n")
            sys.stdout.flush()
