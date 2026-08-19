"""Paso 2 (liviano, uno por cantante) del face swap real de "cara en el
escenario": reusa el análisis ya cacheado por analyze_template_face.py (no
vuelve a detectar nada cuadro a cuadro, esa es la parte cara) y corre el swap
en sí — reemplaza la cara del protagonista del template por la del cantante,
usando su foto como fuente.

Encodea a H.264 vía ffmpeg (subproceso, mismo criterio que
apps/server/src/sync/transcode.ts) en vez de cv2.VideoWriter con el fourcc
mp4v que usa track_face.py --preview: ese es solo para debug interno, esto es
video de producción que tiene que reproducir bien embebido en Chrome. Sin
pista de audio: los templates siempre se reproducen mudos en la app.
"""
import argparse
import json
import os
import subprocess
import sys
import types

import _cuda_dlls  # noqa: F401  (side effect: registra las DLLs de CUDA en Windows antes de onnxruntime)
import _insight_lite
import cv2
import insightface
import numpy as np

PROVIDERS = _insight_lite.PROVIDERS
DET_SIZE = (640, 640)

# inswapper_128 no tiene una perilla de "intensidad" — correr el swap más de
# una vez sobre su propio resultado (realimentando el frame ya swapeado como
# "target" de la pasada siguiente) empuja el resultado más cerca de la foto
# de origen en cada pasada — truco de la comunidad roop/facefusion. Probado
# contra un caso difícil (barba tupida vs. protagonista sin barba del
# template): la diferencia visual de 1 a 3 pasadas resultó marginal, mientras
# que el tiempo más que se duplicó (38.8s -> 88.8s en un template real de
# 720p/240 cuadros) — cuando la cara de origen es muy distinta a la del
# video, el modelo tira fuerte hacia la del video sin importar cuántas
# pasadas corran. Se deja en 1 por default; ajustable por si algún template
# puntual sí se beneficia de más.
SWAP_PASSES = 1

# inswapper_128.onnx no se versiona (pesa ~530MB) — mismo criterio que
# face_landmarker.task (ver track_face.py). A la fecha de escribir esto no hay
# un único mirror oficial estable; conseguirlo y colocarlo a mano en esta ruta.
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "inswapper_128.onnx")


def require_model() -> None:
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"Falta el modelo de swap en {MODEL_PATH}. Es un archivo de ~530MB que no se "
            "versiona (mismo criterio que face_landmarker.task) — conseguí inswapper_128.onnx "
            "y colocalo en esa ruta."
        )


def make_swapper():
    require_model()
    return insightface.model_zoo.get_model(MODEL_PATH, providers=PROVIDERS)


def pick_main_face(faces):
    if not faces:
        return None

    def area(f):
        x1, y1, x2, y2 = f.bbox
        return (x2 - x1) * (y2 - y1)

    return max(faces, key=area)


def open_ffmpeg_writer(out_path: str, width: int, height: int, fps: float) -> subprocess.Popen:
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(fps),
        "-i", "-",
        "-an", "-vcodec", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        out_path,
    ]
    # -loglevel error: además de bajar el ruido, evita un deadlock real — sin
    # esto ffmpeg puede llenar el pipe de stderr con el progreso cuadro a
    # cuadro mientras el loop de abajo sigue escribiéndole a stdin sin leer
    # stderr en paralelo; si el pipe se llena, ffmpeg se bloquea escribiendo
    # y este proceso se bloquea escribiéndole a él — los dos esperando al
    # otro para siempre. Con -loglevel error no hay nada que llene el pipe en
    # el caso normal (solo escribe algo si de verdad falla).
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)


def render(
    video_path: str,
    analysis_path: str,
    source_photo_path: str,
    out_path: str,
    detector,
    recognizer,
    swapper,
    swap_passes: int = SWAP_PASSES,
) -> None:
    """Núcleo reusable: recibe los tres modelos ya armados en vez de crearlos
    (el CLI los arma frescos por corrida vía make_detector/make_recognizer/
    make_swapper más abajo; faceswap_worker.py los arma una sola vez al
    arrancar y los reusa en cada cantante — ahí vive la ganancia real de
    tener un worker persistente). Lanza RuntimeError en vez de sys.exit por
    la misma razón que analyze() en analyze_template_face.py."""
    with open(analysis_path, "r", encoding="utf-8") as f:
        analysis = json.load(f)
    frames_meta = analysis["frames"]
    fps = analysis["fps"]

    photo = cv2.imread(source_photo_path)
    if photo is None:
        raise RuntimeError(f"No se pudo leer la foto: {source_photo_path}")
    source_face = pick_main_face(_insight_lite.detect_faces(detector, photo))
    if source_face is None:
        raise RuntimeError(f"No se detectó ninguna cara en la foto: {source_photo_path}")
    recognizer.get(photo, source_face)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir el video: {video_path}")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = open_ffmpeg_writer(out_path, width, height, fps)

    swapped = 0
    total = 0
    for meta in frames_meta:
        ok, frame = cap.read()
        if not ok:
            break
        total += 1
        if meta["kps"] is not None:
            target_face = types.SimpleNamespace(kps=np.array(meta["kps"], dtype=np.float32))
            # Múltiples pasadas sobre el propio resultado — ver SWAP_PASSES.
            # kps no cambia entre pasadas: paste_back ya deja la cara en la
            # misma posición/pose exacta, solo cambia su identidad/textura.
            for _ in range(swap_passes):
                frame = swapper.get(frame, target_face, source_face, paste_back=True)
            swapped += 1
        writer.stdin.write(frame.tobytes())

    cap.release()
    writer.stdin.close()
    writer.wait()
    if writer.returncode != 0:
        stderr = writer.stderr.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"ffmpeg falló (código {writer.returncode}): {stderr[-2000:]}")

    print(f"OK: {swapped}/{total} cuadros swapeados -> {out_path}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reemplaza la cara del protagonista de un video-template por la de un cantante, "
        "reusando el análisis ya cacheado por analyze_template_face.py."
    )
    parser.add_argument("--video", required=True)
    parser.add_argument("--analysis", required=True, help="analysis.json generado por analyze_template_face.py")
    parser.add_argument("--source-photo", required=True, help="Foto del cantante")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--swap-passes", type=int, default=SWAP_PASSES,
        help="Pasadas del swap sobre su propio resultado — más = más parecido a la foto de origen, menos al video (default: %(default)s)",
    )
    args = parser.parse_args()

    detector = _insight_lite.make_detector(DET_SIZE)
    recognizer = _insight_lite.make_recognizer()
    try:
        swapper = make_swapper()
        render(
            args.video, args.analysis, args.source_photo, args.out,
            detector, recognizer, swapper, swap_passes=args.swap_passes,
        )
    except RuntimeError as err:
        sys.exit(str(err))


if __name__ == "__main__":
    main()
