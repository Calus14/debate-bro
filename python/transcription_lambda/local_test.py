"""
Local CLI for the same transcription pipeline used by Lambda.
Usage:
  python local_test.py -w <waveFilePath> -m <metadataPath>

Writes <basename>.transcription.json into the current working directory.
"""

import argparse
import json
import os
import traceback
from typing import List, Any, Dict

from transcriber import Transcriber, resolve_path

def main(argv: List[str]) -> None:
    p = argparse.ArgumentParser(description="Local transcription test runner.")
    p.add_argument("-w", "--wave", required=True, help="Path to .wav file")
    p.add_argument("-m", "--meta", required=True, help="Path to metadata JSON (.json/.metadata)")
    args = p.parse_args(argv)

    wav_path = resolve_path(args.wave)
    meta_path = resolve_path(args.meta)

    base = os.path.splitext(os.path.basename(wav_path))[0]
    out_path = os.path.join(os.getcwd(), f"{base}.transcription.json")

    try:
        transcriber = Transcriber(model_size="small", device="cpu", compute_type="int8", beam_size=5)
        results = transcriber.process_to_result(wav_path, meta_path)
        payload: Dict[str, Any] = {"status": "ok", "segments": results}
    except Exception as e:
        payload = {
            "status": "failed",
            "error": str(e),
            "error_type": e.__class__.__name__,
            "traceback": "".join(traceback.format_exc())[-4000:],  # cap size
        }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"✅ Wrote {out_path} (status={payload['status']})")

if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
