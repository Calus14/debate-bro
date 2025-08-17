"""
Reusable OO transcription module with unit auto-detection and debug logs.
"""

import json
import os
from typing import Any, Dict, List, Optional

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
        self.debug = True  # force on for now
        self._model: Optional[WhisperModel] = None

    def _log(self, *a: Any) -> None:
        if self.debug:
            print("[transcriber]", *a, flush=True)

    def _model_instance(self) -> WhisperModel:
        if self._model is None:
            self._log(f"Loading model: size={self.model_size} device={self.device} compute={self.compute_type}")
            self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)
        return self._model

    def _assign_speaker(self, start: float, end: float, segs: List[Dict[str, Any]]) -> str:
        """Finds the speaker segment that overlaps a whisper segment."""
        for s in segs:
            if start >= s["start_s"] and end <= s["end_s"]:
                return s["speaker_id"]
        # fallback: if no match, just return first/unknown
        return segs[0]["speaker_id"] if segs else "unknown"

    def process_to_result(self, wav_path: str, metadata_path: str):
        """Transcribe full wav once, then align speaker IDs based on metadata segments."""
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

        # Normalize metadata segments
        norm_segments = []
        for s in raw_segments:
            start_s = _coerce_float(s["start_raw"], 0.0)
            end_s = _coerce_float(s["end_raw"], None)
            if start_s is not None: start_s /= scale
            if end_s is not None:   end_s /= scale
            start_s = max(0.0, start_s or 0.0)
            end_s = min(audio_len_s, end_s) if end_s is not None else audio_len_s
            norm_segments.append({
                "speaker_id": s["speaker_id"],
                "start_s": start_s,
                "end_s": end_s,
            })

        # Run whisper ONCE on the full audio
        model = self._model_instance()
        whisper_segments, _info = model.transcribe(wav_path, beam_size=self.beam_size)

        results = []
        for seg in whisper_segments:
            spk = self._assign_speaker(seg.start, seg.end, norm_segments)
            results.append({
                "speaker_id": spk,
                "start": seg.start,
                "end": seg.end,
                "text": (seg.text or "").strip(),
            })

        return results

    def process_to_path(self, wav_path: str, metadata_path: str, output_path: str) -> None:
        results = self.process_to_result(wav_path, metadata_path)
        with open(output_path, "w", encoding="utf-8") as out_f:
            json.dump(results, out_f, ensure_ascii=False, indent=2)
        self._log(f"Wrote {output_path} with {len(results)} segments")