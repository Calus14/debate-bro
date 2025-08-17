import os, json, tempfile, boto3
from botocore.exceptions import ClientError

s3 = boto3.client("s3")
BUCKET = os.environ["S3_BUCKET_NAME"]

def s3_exists(key: str) -> bool:
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NotFound"):
            return False
        raise

def download_pair(base: str):
    """
    Downloads <base>.wav and a metadata JSON to temp files; returns (wav_path, meta_path).
    Tries <base>.json first, then <base>.metadata, then <base>.meta.json.
    """
    tmpdir = tempfile.mkdtemp()
    leaf = base.rsplit("/", 1)[-1]
    wav_key = f"{base}.wav"
    wav_path = os.path.join(tmpdir, f"{leaf}.wav")

    s3.download_file(BUCKET, wav_key, wav_path)

    meta_candidates = [f"{base}.json", f"{base}.metadata", f"{base}.meta.json"]
    meta_key = None
    for cand in meta_candidates:
        if s3_exists(cand):
            meta_key = cand
            break
    if not meta_key:
        raise FileNotFoundError(f"No metadata JSON found for base={base}")

    meta_path = os.path.join(tmpdir, f"{leaf}.metadata.json")
    s3.download_file(BUCKET, meta_key, meta_path)
    return wav_path, meta_path

def put_json(key: str, obj: dict):
    s3.put_object(
        Bucket=BUCKET, Key=key,
        Body=json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8"),
        ContentType="application/json"
    )

def atomic_write_json(final_key: str, obj: dict):
    tmp_key = f"{final_key}.tmp"
    put_json(tmp_key, obj)
    s3.copy_object(Bucket=BUCKET, CopySource={"Bucket": BUCKET, "Key": tmp_key}, Key=final_key)
    s3.delete_object(Bucket=BUCKET, Key=tmp_key)

def list_wavs_missing_transcripts(prefix: str):
    """Yield base keys (without .wav) for which .transcription.json/.tmp don't exist."""
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".wav"):
                continue
            base = key[:-4]
            final_key = f"{base}.transcription.json"
            if s3_exists(final_key) or s3_exists(final_key + ".tmp"):
                continue
            yield base
