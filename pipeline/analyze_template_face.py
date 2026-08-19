"""Paso 1 (pesado, una sola vez por template) del face swap real de "cara en
el escenario": detecta la cara del protagonista en cada cuadro de un
video-template y cachea su posición (landmarks de 5 puntos) para que el swap
por cantante (render_singer_faceswap.py) no tenga que volver a detectar nada
— solo reusa este análisis y corre la parte liviana (el swap en sí).

A diferencia de track_face.py (MediaPipe, sirve al óvalo "sticker" manual),
acá se usa insightface: inswapper_128.onnx (el modelo de swap que consume
render_singer_faceswap.py) espera específicamente la alineación de 5 puntos
que produce insightface, así que la detección tiene que salir de la misma
librería para no desalinear el swap.
"""
import argparse
import json
import sys

import _cuda_dlls  # noqa: F401  (side effect: registra las DLLs de CUDA en Windows antes de onnxruntime)
import _insight_lite
import cv2

# Preferimos GPU si hay (este paso sí recorre el video cuadro a cuadro, es el
# costoso) — onnxruntime elige el primer proveedor disponible de la lista, cae
# solo a CPU si no hay CUDA instalado.
DET_SIZE = (640, 640)


def make_analyzer():
    # Solo el detector (bbox + kps de 5 puntos) — no pasamos por FaceAnalysis
    # ni cargamos landmark_2d_106/landmark_3d_68/genderage/recognition, que acá
    # no se usan para nada. Ver _insight_lite.py.
    return _insight_lite.make_detector(DET_SIZE)


def pick_main_face(faces):
    """Si hay más de una cara en cuadro, nos quedamos con la del protagonista
    (bbox más grande) — el prompt del template pide un solo protagonista en la
    zona de la cara, ver .claude/agents/director-escenas.md."""
    if not faces:
        return None

    def area(f):
        x1, y1, x2, y2 = f.bbox
        return (x2 - x1) * (y2 - y1)

    return max(faces, key=area)


def extract_track(video_path: str, analyzer) -> tuple[list[dict], float, int, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir el video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frames: list[dict] = []
    frame_idx = 0
    missing = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = frame_idx / fps
        face = pick_main_face(_insight_lite.detect_faces(analyzer, frame))
        if face is not None:
            frames.append({
                "t": t,
                "visible": True,
                "bbox": [float(v) for v in face.bbox],
                "kps": face.kps.tolist(),
            })
        else:
            missing += 1
            frames.append({"t": t, "visible": False, "bbox": None, "kps": None})
        frame_idx += 1

    cap.release()
    print(f"OK: {frame_idx} frames, {missing} sin cara detectada", file=sys.stderr)
    return frames, fps, width, height


def fill_gaps(frames: list[dict]) -> None:
    """Sostiene la última detección válida en los huecos sin cara (y hacia
    atrás para huecos al principio del clip) — no promedia los kps: una
    interpolación punto a punto entre dos detecciones podría deformar la
    geometría de la cara en vez de simplemente sostenerla quieta, que es
    preferible para un hueco corto (oclusión momentánea)."""
    last = None
    for f in frames:
        if f["visible"]:
            last = f
        elif last is not None:
            f["bbox"], f["kps"] = last["bbox"], last["kps"]

    # Huecos al principio del clip (antes de la primera detección): usar la
    # primera cara detectada, recorriendo para atrás.
    first = next((f for f in frames if f["bbox"] is not None), None)
    if first is None:
        return
    for f in frames:
        if f["bbox"] is None:
            f["bbox"], f["kps"] = first["bbox"], first["kps"]
        else:
            break


def analyze(video_path: str, out_path: str, analyzer) -> None:
    """Núcleo reusable: recibe un analyzer ya armado (el CLI arma uno fresco por
    corrida vía make_analyzer(); faceswap_worker.py arma uno solo al empezar y
    lo reusa en cada template) y hace todo el trabajo — detectar, rellenar
    huecos, escribir el JSON. Lanza RuntimeError en vez de sys.exit para que
    tanto el CLI (atrapa acá abajo) como el worker (atrapa distinto, no puede
    permitirse un sys.exit que lo mate entero) puedan manejar el error a su
    manera."""
    frames, fps, width, height = extract_track(video_path, analyzer)
    fill_gaps(frames)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"video": video_path, "fps": fps, "width": width, "height": height, "frames": frames}, f)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analiza la cara del protagonista de un video-template (detección + landmarks de "
        "5 puntos, cuadro a cuadro) y cachea el resultado para que el swap por cantante sea liviano."
    )
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True, help="Ruta del JSON de salida (analysis.json)")
    args = parser.parse_args()

    analyzer = make_analyzer()
    try:
        analyze(args.video, args.out, analyzer)
    except RuntimeError as err:
        sys.exit(str(err))


if __name__ == "__main__":
    main()
