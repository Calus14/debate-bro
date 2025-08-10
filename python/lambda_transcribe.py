"""
AWS Lambda handler for transcribing Discord voice recordings.

This function is triggered by an S3 event when a `.wav` audio file and a
corresponding `.metadata` JSON file are uploaded.  The metadata file is
expected to contain a list of segments with start/end times and the user
identifier for each speaker.  Using the open‑source `faster‑whisper` model
provides high‑quality speech recognition without incurring per‑request
service fees, keeping transcription costs low while remaining reliable.

Upon invocation the function downloads the audio and metadata from S3,
splits the audio into per‑speaker clips based on the metadata, runs
transcription on each clip, and then combines the results with speaker
and timing information.  The resulting list of transcribed segments is
written back to S3 as a JSON file with the same prefix as the input
audio.

Dependencies (declared in requirements.txt):
  - boto3          (for S3 interactions)
  - faster-whisper (speech recognition)
  - pydub          (audio slicing, requires ffmpeg in the Lambda layer)

Note: Ensure ffmpeg is available in the Lambda environment; you may
include it via a Lambda layer or by using a custom runtime based on
Amazon Linux.
"""

import json
import os
import tempfile
from typing import List, Dict, Any

import boto3
from faster_whisper import WhisperModel
from pydub import AudioSegment


# Global S3 client reused across invocations
s3_client = boto3.client("s3")

# Cache the Whisper model across invocations to avoid repeated loading.
_cached_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    """Lazily load and return a Whisper model.

    A smaller model (e.g. "small") is chosen to balance cost and
    accuracy.  The model will reside in `/tmp` after first load and
    reused across subsequent Lambda invocations.
    """
    global _cached_model
    if _cached_model is None:
        # Choose a small model for low latency/cost; adjust as needed.
        _cached_model = WhisperModel("small", device="cpu", compute_type="int8")
    return _cached_model


def transcribe_clip(model: WhisperModel, audio_path: str) -> List[Dict[str, Any]]:
    """Run transcription on a single audio clip.

    Returns a list of segments with start, end, and text fields.  The
    start and end times are relative to the beginning of the clip.
    """
    segments, _ = model.transcribe(audio_path, beam_size=5)
    results: List[Dict[str, Any]] = []
    for seg in segments:
        results.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text.strip(),
        })
    return results


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, str]:
    """Entry point for AWS Lambda.

    The event is expected to contain an S3 notification with the key of
    the uploaded `.wav` file.  A corresponding `.metadata` file with the
    same prefix is assumed to exist.  The function writes a `.json`
    transcription file back to the same bucket.
    """
    # Extract bucket and object key from the event.  We assume a single
    # record for simplicity; multiple records can be handled similarly.
    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    key = record["s3"]["object"]["key"]

    # Derive the base name without extension to locate the metadata and
    # determine the output file name.
    base_name, ext = os.path.splitext(key)
    if ext.lower() != ".wav":
        # Ignore unsupported file types.
        return {"status": f"ignored {ext}"}

    meta_key = f"{base_name}.metadata"
    output_key = f"{base_name}.transcription.json"

    # Work in a temporary directory so that files are cleaned up automatically.
    with tempfile.TemporaryDirectory() as tmpdir:
        audio_local_path = os.path.join(tmpdir, os.path.basename(key))
        meta_local_path = os.path.join(tmpdir, os.path.basename(meta_key))
        output_local_path = os.path.join(tmpdir, os.path.basename(output_key))

        # Download audio and metadata files from S3
        s3_client.download_file(bucket, key, audio_local_path)
        s3_client.download_file(bucket, meta_key, meta_local_path)

        # Load metadata; expect a JSON structure with a list of segments
        # Each segment should contain at minimum: start (float seconds),
        # end (float seconds), and optionally speaker_id.
        with open(meta_local_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        segments_meta = metadata.get("segments", [])
        if not segments_meta:
            # If no segment information, treat entire file as one segment
            segments_meta = [{"start": 0.0, "end": None, "speaker_id": "unknown"}]

        # Load model once
        model = get_model()

        # Load full audio for slicing
        full_audio = AudioSegment.from_file(audio_local_path)

        transcribed_segments: List[Dict[str, Any]] = []

        for seg_meta in segments_meta:
            start_sec = float(seg_meta.get("start", 0.0))
            end_sec = seg_meta.get("end")
            # Convert to milliseconds for pydub
            start_ms = int(start_sec * 1000)
            # If end is None, transcribe until the end of the file
            end_ms = int(float(end_sec) * 1000) if end_sec is not None else len(full_audio)

            # Extract the segment
            segment_audio = full_audio[start_ms:end_ms]
            clip_path = os.path.join(tmpdir, f"clip_{start_ms}_{end_ms}.wav")
            segment_audio.export(clip_path, format="wav")

            # Transcribe the clip
            clip_transcripts = transcribe_clip(model, clip_path)
            speaker_id = seg_meta.get("speaker_id", "unknown")
            for clip_seg in clip_transcripts:
                # Offset segment times by the start of the clip
                transcribed_segments.append({
                    "speaker_id": speaker_id,
                    "start": start_sec + clip_seg["start"],
                    "end": (start_sec + clip_seg["end"]) if clip_seg["end"] is not None else None,
                    "text": clip_seg["text"],
                })

        # Write result JSON
        with open(output_local_path, "w", encoding="utf-8") as out_f:
            json.dump(transcribed_segments, out_f, ensure_ascii=False, indent=2)

        # Upload transcription back to S3
        s3_client.upload_file(output_local_path, bucket, output_key)

    return {"status": "transcribed", "output_key": output_key}