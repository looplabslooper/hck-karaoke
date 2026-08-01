import argparse
import sys
from pathlib import Path

import torch
from demucs.api import Separator, save_audio


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Separa voz/instrumental de un audio con Demucs — para alinear WhisperX contra el stem "
        "vocal (mejor calidad que la mezcla completa) y, de paso, obtener la pista instrumental."
    )
    parser.add_argument("--audio", required=True)
    parser.add_argument("--out-dir", required=True, help="Carpeta donde quedan vocals.wav e instrumental.wav")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    separator = Separator(model="htdemucs", device=device)
    _, stems = separator.separate_audio_file(Path(args.audio))

    # htdemucs separa en 4 stems (vocals/drums/bass/other); sumamos los tres
    # no-vocales para armar "instrumental" en vez de usar --two-stems de la
    # CLI, que hace exactamente esto por detrás pero obliga a pasar por un
    # subprocess + una carpeta de trabajo propia.
    instrumental = stems['drums'] + stems['bass'] + stems['other']

    vocals_path = out_dir / 'vocals.wav'
    instrumental_path = out_dir / 'instrumental.wav'
    save_audio(stems['vocals'], vocals_path, separator.samplerate)
    save_audio(instrumental, instrumental_path, separator.samplerate)

    print(f"OK: vocals={vocals_path} instrumental={instrumental_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
