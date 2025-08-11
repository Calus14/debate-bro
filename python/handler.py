"""
AWS Lambda handler that delegates to the shared Transcriber.
Downloads .wav and matching .metadata from S3, runs transcription,
and uploads <basename>.transcription.json back to S3.
"""

import json
import os
import tempfile
from typing import Any, Dict

import boto3
from transcriber import Transcriber

s3 = boto3.client("s3")  # reuse across warm invocations


def lambda_handler(event: Dict[str, Any], _context: Any) -> Dict[str, str]:
    # Assume a single S3 record (extend if you batch events)
    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    key = record["s3"]["object"]["key"]

    base, ext = os.path.splitext(key)
    if ext.lower() != ".wav":
        return {"status": f"ignored {ext}"}

    meta_key = f"{base}.metadata"
    out_key = f"{base}.transcription.json"

    with tempfile.TemporaryDirectory() as td:
        wav_local = os.path.join(td, os.path.basename(key))
        meta_local = os.path.join(td, os.path.basename(meta_key))
        out_local = os.path.join(td, os.path.basename(out_key))

        # Download inputs
        s3.download_file(bucket, key, wav_local)
        s3.download_file(bucket, meta_key, meta_local)

        # Run transcription via shared OO module
        transcriber = Transcriber(model_size="small", device="cpu", compute_type="int8", beam_size=5)
        transcriber.process_to_path(wav_local, meta_local, out_local)

        # Upload result
        s3.upload_file(out_local, bucket, out_key)

    return {"status": "transcribed", "output_key": out_key}
