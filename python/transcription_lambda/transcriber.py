"""
Reusable OO transcription module with unit auto-detection and debug logs.
"""

import json
import os
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from faster_whisper import WhisperModel
from pydub import AudioSegment


def resolve_path(path: str) -> str:
    if os.path.exists(path):
        return path
    ap = os.path.abspath(path)
    if os.path.exists(ap):
        return ap
    raise FileNotFoundError(f"File not found: {path}")


def _coerce_float(x: Any, default: Optional[float]) -> Optional[float]:
    if x is None:
        return default
    try:
        return float(x)
    except Exception:
        return default


def _load_segments(metadata: Any) -> List[Dict[str, Any]]:
    """
    Accepts either:
      - {'segments': [ ... ]}
      - [ ... ]
    Supports:
      - start / end in seconds
      - start_ms / end_ms
      - userId for speaker ID
    """
    if isinstance(metadata, dict):
        segs = metadata.get("segments") or metadata.get("Segments") or []
    elif isinstance(metadata, list):
        segs = metadata
    else:
        segs = []

    out: List[Dict[str, Any]] = []
    for s in segs:
        if not isinstance(s, dict):
            continue
        start = s.get("start", s.get("start_ms"))
        end = s.get("end", s.get("end_ms"))
        # Prefer userId over speaker_id over speaker
        speaker = (
            s.get("userId")
            or s.get("speaker_id")
            or s.get("speaker")
            or "unknown"
        )
        out.append({
            "start_raw": start,
            "end_raw": end,
            "speaker_id": str(speaker)  # always string
        })
    if not out:
        out = [{"start_raw": 0.0, "end_raw": None, "speaker_id": "unknown"}]
    return out


def _infer_unit_scale(segments: List[Dict[str, Any]], audio_dur_s: float) -> float:
    """
    Returns a scale factor to convert raw times -> seconds.

    Heuristic: compare the max end/start to duration and pick the scale that
    makes values "line up" with duration.
    """
    raw_vals: List[float] = []
    for s in segments:
        st = _coerce_float(s["start_raw"], None)
        en = _coerce_float(s["end_raw"], None)
        if st is not None:
            raw_vals.append(st)
        if en is not None:
            raw_vals.append(en)
    if not raw_vals:
        return 1.0

    max_raw = max(raw_vals)

    # If already looks like seconds
    if max_raw <= max(1.0, audio_dur_s * 1.5):
        return 1.0

    # Candidate scales (ms, common sample rates)
    candidates = [1000.0, 8000.0, 16000.0, 22050.0, 44100.0, 48000.0]
    best_scale = 1.0
    best_err = float("inf")
    for scale in candidates:
        est_dur = max_raw / scale
        # relative error vs audio duration
        err = abs(est_dur - audio_dur_s) / max(1e-6, audio_dur_s)
        if err < best_err:
            best_err = err
            best_scale = scale

    return best_scale


class Transcriber:
    def __init__(
        self,
        model_size: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        beam_size: int = 5,
        debug: bool = False,
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.beam_size = beam_size
        self.debug = True#debug or os.getenv("TRANSCRIBE_DEBUG", "0") in ("1", "true", "True")
        self._model: Optional[WhisperModel] = None

    def _log(self, *a: Any) -> None:
        if self.debug:
            print("[transcriber]", *a, flush=True)

    def _model_instance(self) -> WhisperModel:
        if self._model is None:
            self._log(f"Loading model: size={self.model_size} device={self.device} compute={self.compute_type}")
            self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)
        return self._model

    def _transcribe_clip(self, clip_path: str) -> List[Dict[str, Any]]:
        model = self._model_instance()
        segments, _info = model.transcribe(clip_path, beam_size=self.beam_size)
        out: List[Dict[str, Any]] = []
        for seg in segments:
            out.append(
                {
                    "start": seg.start,
                    "end": seg.end,
                    "text": (seg.text or "").strip(),
                }
            )
        return out

    def process_to_result(self, wav_path: str, metadata_path: str):
            """Same as process_to_path but returns the JSON-able result list instead of writing a file."""
            wav_path = resolve_path(wav_path)
            meta_path = resolve_path(metadata_path)

            with open(meta_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)

            raw_segments = _load_segments(metadata)
            full_audio = AudioSegment.from_file(wav_path)
            audio_len_ms = len(full_audio)
            audio_len_s = audio_len_ms / 1000.0

            scale = _infer_unit_scale(raw_segments, audio_len_s)
            self._log(f"Audio duration: {audio_len_s:.2f}s  segments(raw)={len(raw_segments)}  unit_scale={scale}")

            segments = []
            for s in raw_segments:
                start_s = _coerce_float(s["start_raw"], 0.0)
                end_s = _coerce_float(s["end_raw"], None)
                if start_s is not None: start_s /= scale
                if end_s is not None:   end_s /= scale

                start_ms = int(max(0.0, (start_s or 0.0)) * 1000)
                end_ms = int((end_s * 1000)) if end_s is not None else audio_len_ms
                end_ms = max(start_ms, min(end_ms, audio_len_ms))
                segments.append({
                    "speaker_id": s["speaker_id"],
                    "start_s": (start_ms / 1000.0),
                    "end_s": (end_ms / 1000.0) if end_s is not None else (audio_len_ms / 1000.0),
                    "start_ms": start_ms, "end_ms": end_ms,
                })

            if self.debug:
                self._log("First 5 normalized segments:")
                for i, seg in enumerate(segments[:5]):
                    self._log(f"  #{i}: {seg}")

            results = []
            with tempfile.TemporaryDirectory() as td:
                for i, seg in enumerate(segments):
                    if seg["end_ms"] <= seg["start_ms"]:
                        self._log(f"Skip zero-length seg #{i}: {seg}")
                        continue
                    clip_path = os.path.join(td, f"clip_{seg['start_ms']}_{seg['end_ms']}.wav")
                    self._log(f"Exporting seg #{i}: {seg}")
                    full_audio[seg["start_ms"]:seg["end_ms"]].export(clip_path, format="wav")
                    pieces = self._transcribe_clip(clip_path)
                    for p in pieces or []:
                        results.append({
                            "speaker_id": seg["speaker_id"],
                            "start": seg["start_s"] + (p.get("start") or 0.0),
                            "end": seg["start_s"] + (p.get("end") or 0.0) if p.get("end") is not None else None,
                            "text": p.get("text", ""),
                        })
            return results

    def process_to_path(self, wav_path: str, metadata_path: str, output_path: str) -> None:
        results = self.process_to_result(wav_path, metadata_path)
        with open(output_path, "w", encoding="utf-8") as out_f:
            json.dump(results, out_f, ensure_ascii=False, indent=2)
        self._log(f"Wrote {output_path} with {len(results)} segments")
