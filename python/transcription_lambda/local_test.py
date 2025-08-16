"""
Local CLI for the same transcription pipeline used by Lambda.
Usage:
  python local_test.py -w <waveFilePath> -m <metadataPath>

Resolves relative paths first, then absolute. Writes
<basename>.transcription.json into the current working directory.
"""

import argparse
import json
import os
from typing import List

from transcriber import Transcriber, resolve_path


def main(argv: List[str]) -> None:
    p = argparse.ArgumentParser(description="Local transcription test runner.")
    p.add_argument("-w", "--wave", required=True, help="Path to .wav file")
    p.add_argument("-m", "--meta", required=True, help="Path to .metadata JSON")
    args = p.parse_args(argv)

    wav_path = resolve_path(args.wave)
    meta_path = resolve_path(args.meta)

    base = os.path.splitext(os.path.basename(wav_path))[0]
    out_path = os.path.join(os.getcwd(), f"{base}.transcription.json")

    transcriber = Transcriber(model_size="small", device="cpu", compute_type="int8", beam_size=5)
    transcriber.process_to_path(wav_path, meta_path, out_path)

    print(f"✅ Wrote {out_path}")


if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
