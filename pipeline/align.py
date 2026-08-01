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

    # Se probó (y se descartó) anclar la alineación a segmentos reales
    # detectados por VAD/transcripción de Whisper, repartiendo la letra
    # proporcionalmente entre esos tramos antes de alinear cada uno por
    # separado. En la práctica, contra audio real ("Stitches"), el reparto
    # proporcional por cantidad de palabras transcriptas es demasiado frágil:
    # tramos de VAD desparejos meten palabras de más o de menos en cada
    # ventana y el error termina siendo peor que el que se buscaba evitar
    # (llegó a producir un hueco de 32s donde antes no había ninguno). Un solo
    # bloque para toda la canción, con el idioma correcto (ver ROADMAP.md),
    # dio resultado limpio de punta a punta — no reintentar esto sin un
    # method de matching texto-a-texto real (ver nota en ROADMAP.md).
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

    # Un hueco real entre el fin de una palabra y el inicio de la siguiente
    # (instrumental, silencio) no puede quedar "adentro" de la misma línea:
    # si no cortamos acá, la pantalla muestra la frase completa ya desde el
    # arranque y se queda pegada varios segundos sin que nada coincida con lo
    # que se está cantando. El umbral coincide con MIN_GAP_SECONDS del lado
    # del cliente (LyricsView.tsx) — mismo criterio de "esto ya es una pausa
    # real, no una separación normal entre palabras".
    MIN_GAP_SECONDS = 1.2

    def close_line(words: list[dict]) -> None:
        lines_out.append({"start": words[0]["start"], "end": words[-1]["end"], "words": words})

    lines_out: list[dict] = []
    idx = 0
    dropped = 0
    for line in raw_lines:
        words_in_line = line.split()
        current_words: list[dict] = []
        for _ in words_in_line:
            if idx < len(aligned_words):
                w = aligned_words[idx]
                if w.get("start") is not None and w.get("end") is not None:
                    start, end = w["start"], w["end"]
                    swallowed_gap = end - start > MAX_WORD_SECONDS
                    if swallowed_gap:
                        end = start + MAX_WORD_SECONDS
                    elif current_words and start - current_words[-1]["end"] > MIN_GAP_SECONDS:
                        close_line(current_words)
                        current_words = []
                    current_words.append({"t": w["word"].strip(), "start": start, "end": end})
                    if swallowed_gap:
                        # la palabra sola ya se comió el hueco: cerramos acá
                        # también, la próxima palabra arranca línea nueva.
                        close_line(current_words)
                        current_words = []
                else:
                    dropped += 1
            idx += 1
        if current_words:
            close_line(current_words)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"lines": lines_out}, f, ensure_ascii=False)

    total_words = sum(len(l["words"]) for l in lines_out)
    print(f"OK: {len(lines_out)} lineas, {total_words} palabras alineadas, {dropped} sin timestamp", file=sys.stderr)


if __name__ == "__main__":
    main()
