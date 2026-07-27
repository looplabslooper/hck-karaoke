import argparse
import json
import sys

import torch
import whisperx


def main() -> None:
    parser = argparse.ArgumentParser(description="Alinea una letra pegada a mano contra un audio (WhisperX).")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--lyrics", required=True, help="Archivo de texto, una línea de letra por línea")
    parser.add_argument("--language", default="es")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"

    with open(args.lyrics, "r", encoding="utf-8") as f:
        raw_lines = [line.strip() for line in f if line.strip()]

    audio = whisperx.load_audio(args.audio)
    duration = len(audio) / 16000  # whisperx carga el audio a 16kHz

    full_text = " ".join(raw_lines)
    segments = [{"text": full_text, "start": 0.0, "end": duration}]

    model_a, metadata = whisperx.load_align_model(language_code=args.language, device=device)
    result = whisperx.align(segments, model_a, metadata, audio, device, return_char_alignments=False)

    aligned_words = [w for seg in result["segments"] for w in seg.get("words", [])]

    # Guarda de sanidad: una palabra real (cantada o hablada) casi nunca dura
    # más de un par de segundos. Si el alineador se comió un silencio/intro
    # largo dentro de una sola palabra (pasa con intros instrumentales antes
    # de la voz), recortamos su duración en vez de dejarla "colgada" en pantalla.
    MAX_WORD_SECONDS = 2.5

    lines_out = []
    idx = 0
    dropped = 0
    for line in raw_lines:
        words_in_line = line.split()
        line_words = []
        for _ in words_in_line:
            if idx < len(aligned_words):
                w = aligned_words[idx]
                if w.get("start") is not None and w.get("end") is not None:
                    start, end = w["start"], w["end"]
                    if end - start > MAX_WORD_SECONDS:
                        end = start + MAX_WORD_SECONDS
                    line_words.append({"t": w["word"].strip(), "start": start, "end": end})
                else:
                    dropped += 1
            idx += 1
        if line_words:
            lines_out.append({"start": line_words[0]["start"], "end": line_words[-1]["end"], "words": line_words})

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"lines": lines_out}, f, ensure_ascii=False)

    total_words = sum(len(l["words"]) for l in lines_out)
    print(f"OK: {len(lines_out)} lineas, {total_words} palabras alineadas, {dropped} sin timestamp", file=sys.stderr)


if __name__ == "__main__":
    main()
