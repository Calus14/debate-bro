"""
AWS Lambda handler that delegates to the shared Transcriber.
Downloads .wav and matching .metadata from S3, runs transcription,
and uploads <basename>.transcription.json back to S3.
"""

import json, os, traceback
from typing import Any, Dict

from transcriber import Transcriber
from s3_utils import (
    s3_exists, download_pair, atomic_write_json, list_wavs_missing_transcripts
)

def _process_base(base: str):
    final_key = f"{base}.transcription.json"

    # Skip if already present or mid-publish
    if s3_exists(final_key) or s3_exists(final_key + ".tmp"):
        print(f"[lambda] Skip existing {final_key}", flush=True)
        return

    # --- Download pair: don't kill the whole invocation if it fails ---
    try:
        wav_path, meta_path = download_pair(base)
    except Exception as e:
        print(f"[lambda] download_pair failed for base={base}: {e}", flush=True)
        # Intentionally NOT writing an error file here—likely metadata isn't uploaded yet.
        return

    # --- Transcribe: if it fails, still write an error JSON so we don't retry forever ---
    try:
        results = Transcriber().process_to_result(wav_path, meta_path)
        payload: Dict[str, Any] = {"status": "ok", "segments": results}
    except Exception as e:
        print(f"[lambda] transcription failed for base={base}: {e}", flush=True)
        payload = {
            "status": "failed",
            "error": str(e),
            "error_type": e.__class__.__name__,
            "traceback": "".join(traceback.format_exc())[-4000:],  # cap size
        }

    atomic_write_json(final_key, payload)
    print(f"[lambda] wrote {final_key} (status={payload['status']})", flush=True)

def lambda_handler(event, ctx):
    # Process the uploaded .wav
    for rec in event.get("Records", []):
        k = rec["s3"]["object"]["key"]
        if not k.endswith(".wav"):
            continue
        base = k[:-4]
        _process_base(base)

        prefix = "/".join(k.split("/")[:-1]) + "/"
        for b in list_wavs_missing_transcripts(prefix):
            _process_base(b)