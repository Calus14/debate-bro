"""
Command‑line transcription tool for Discord voice recordings.

This script mirrors the functionality of the AWS Lambda handler but
runs locally.  Given a WAV file and a corresponding metadata JSON
file, it splits the audio into per‑speaker segments based on the
metadata, transcribes each segment using the open‑source `faster‑whisper`
model, and writes the resulting list of segments to a JSON file
in the current working directory.  The output file is named after
the input WAV file with a `.transcription.json` suffix.

Usage:
    python local_transcribe.py -w <waveFilePath> -m <metadataPath>

The script first tries to interpret the provided paths relative to
the current working directory.  If that fails, it treats them as
absolute paths.  An error is raised if the files cannot be found.
"""

import argparse
import json
import os
import sys
import tempfile
from typing import List, Dict, Any

from faster_whisper import WhisperModel
from pydub import AudioSegment


def resolve_path(path: str) -> str:
    """Resolve a file path, preferring relative paths first.

    If the given path exists as provided (relative to cwd), it is
    returned directly.  Otherwise, `os.path.abspath` is called and
    existence is checked.  A FileNotFoundError is raised if no file
    exists at either location.
    """
    # Expand user (~) and environment variables
    path_expanded = os.path.expanduser(os.path.expandvars(path))
    if os.path.exists(path_expanded):
        return path_expanded
    abs_path = os.path.abspath(path_expanded)
    if os.path.exists(abs_path):
        return abs_path
    raise FileNotFoundError(f"File not found: {path}")


def load_model() -> WhisperModel:
    """Load and return a Whisper model.

    A small model is chosen for good accuracy with reasonable runtime.
    The model is cached in a temporary directory to speed up
    subsequent runs.
    """
    return WhisperModel("small", device="cpu", compute_type="int8")


def transcribe_clip(model: WhisperModel, audio_path: str) -> List[Dict[str, Any]]:
    """Transcribe a single audio clip and return a list of segments."""
    segments, _ = model.transcribe(audio_path, beam_size=5)
    results: List[Dict[str, Any]] = []
    for seg in segments:
        results.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text.strip(),
        })
    return results


def main(args: List[str]) -> None:
    parser = argparse.ArgumentParser(description="Transcribe a WAV file with speaker metadata.")
    parser.add_argument("-w", "--wave", required=True, help="Path to the .wav audio file")
    parser.add_argument("-m", "--meta", required=True, help="Path to the .metadata JSON file")
    parsed = parser.parse_args(args)

    # Resolve file paths
    audio_path = resolve_path(parsed.wave)
    meta_path = resolve_path(parsed.meta)

    # Derive output file name based on WAV file
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    output_path = os.path.join(os.getcwd(), f"{base_name}.transcription.json")

    # Load metadata
    with open(meta_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    segments_meta = metadata.get("segments", [])
    if not segments_meta:
        segments_meta = [{"start": 0.0, "end": None, "speaker_id": "unknown"}]

    # Load model
    model = load_model()

    # Load full audio
    full_audio = AudioSegment.from_file(audio_path)

    transcribed_segments: List[Dict[str, Any]] = []

    # Transcribe each defined segment
    for seg_meta in segments_meta:
        start_sec = float(seg_meta.get("start", 0.0))
        end_sec = seg_meta.get("end")
        start_ms = int(start_sec * 1000)
        end_ms = int(float(end_sec) * 1000) if end_sec is not None else len(full_audio)

        # Extract and temporarily save the segment
        with tempfile.TemporaryDirectory() as tmpdir:
            clip_path = os.path.join(tmpdir, f"clip_{start_ms}_{end_ms}.wav")
            full_audio[start_ms:end_ms].export(clip_path, format="wav")
            clip_transcripts = transcribe_clip(model, clip_path)
            speaker_id = seg_meta.get("speaker_id", "unknown")
            for clip_seg in clip_transcripts:
                transcribed_segments.append({
                    "speaker_id": speaker_id,
                    "start": start_sec + clip_seg["start"],
                    "end": (start_sec + clip_seg["end"]) if clip_seg["end"] is not None else None,
                    "text": clip_seg["text"],
                })

    # Write transcription output
    with open(output_path, "w", encoding="utf-8") as out_f:
        json.dump(transcribed_segments, out_f, ensure_ascii=False, indent=2)
    print(f"Transcription written to {output_path}")


if __name__ == "__main__":
    main(sys.argv[1:])