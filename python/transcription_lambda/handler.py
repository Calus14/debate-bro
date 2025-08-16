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


def lambda_handler(event, ctx):
    for rec in event['Records']:  # S3 event, suffix=.wav
        key = rec['s3']['object']['key']
        if not key.endswith('.wav'):
            continue
        base = key[:-4]
        final_key = f"{base}.transcription.json"
        tmp_key   = f"{final_key}.tmp"

        if s3_exists(final_key):
            continue  # idempotent

        # (Optional) sweep: list objects under this call prefix and process any .wav lacking a .json
        # else: just process this one pair

        audio_path, meta_path = download_pair(base)
        result = transcribe(audio_path, meta_path)  # your Transcriber

        put_json(tmp_key, result)                   # full content
        copy_object(tmp_key, final_key)             # atomic publish
        delete_object(tmp_key)
