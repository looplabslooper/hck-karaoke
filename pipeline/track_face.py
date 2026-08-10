import argparse
import json
import os
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

# Puntos de FaceMesh (topología de 468 landmarks, sin iris) usados para
# ubicar la cara sin depender de los landmarks de iris (que requieren
# num_faces con refine y no aportan nada para un óvalo de posición/ángulo/
# escala).
LEFT_EYE_OUTER, LEFT_EYE_INNER = 33, 133
RIGHT_EYE_INNER, RIGHT_EYE_OUTER = 362, 263
CHIN = 152

# mediapipe 1.0 sacó la API vieja (`mp.solutions.face_mesh`, con el modelo
# embebido en el pip package) a favor de la Tasks API, que necesita este
# .task bajado aparte (ver README del pipeline). No se versiona (pesa ~3.6MB
# y se re-descarga con un curl, mismo criterio que pipeline/.venv/).
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task")


def make_landmarker(mode) -> "vision.FaceLandmarker":
    if not os.path.exists(MODEL_PATH):
        sys.exit(
            f"Falta el modelo en {MODEL_PATH}. Bajalo con:\n"
            f'  curl -fsSL "https://storage.googleapis.com/mediapipe-models/face_landmarker/'
            f'face_landmarker/float16/latest/face_landmarker.task" -o "{MODEL_PATH}"'
        )
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=mode,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.FaceLandmarker.create_from_options(options)


def landmarks_to_transform(lm) -> tuple[float, float, float, float]:
    """De los landmarks de un frame/foto saca (cx, cy, angle, scale), todos
    normalizados contra el ancho/alto de esa misma imagen — así el resultado
    es comparable entre una foto y un frame de video de otra resolución.
    Compartido entre el tracking de video y el compositor de prueba
    (compose_preview.py) para no calcular esto dos veces distinto."""
    left_eye = np.array([(lm[LEFT_EYE_OUTER].x + lm[LEFT_EYE_INNER].x) / 2,
                          (lm[LEFT_EYE_OUTER].y + lm[LEFT_EYE_INNER].y) / 2])
    right_eye = np.array([(lm[RIGHT_EYE_INNER].x + lm[RIGHT_EYE_OUTER].x) / 2,
                           (lm[RIGHT_EYE_INNER].y + lm[RIGHT_EYE_OUTER].y) / 2])
    chin = np.array([lm[CHIN].x, lm[CHIN].y])
    eye_mid = (left_eye + right_eye) / 2
    # centro entre los ojos y el mentón, no el punto medio de los ojos solo:
    # si no, el óvalo queda corrido hacia arriba de la cara.
    cx, cy = (eye_mid + chin) / 2
    angle = float(np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0]))
    # distancia interocular normalizada por ancho de imagen: sirve como
    # referencia de escala independiente de la resolución de origen.
    scale = float(np.linalg.norm(right_eye - left_eye))
    return float(cx), float(cy), angle, scale


def extract_raw_track(video_path: str) -> tuple[list[dict], float, int, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"No se pudo abrir el video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    landmarker = make_landmarker(vision.RunningMode.VIDEO)

    frames: list[dict] = []
    frame_idx = 0
    missing = 0
    last_timestamp_ms = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = frame_idx / fps
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        # detect_for_video exige timestamps estrictamente crecientes; con fps
        # muy alto el redondeo a ms podría repetir uno, así que se fuerza
        # +1ms sobre el anterior en ese caso puntual.
        timestamp_ms = max(int(t * 1000), last_timestamp_ms + 1)
        last_timestamp_ms = timestamp_ms
        result = landmarker.detect_for_video(mp_image, timestamp_ms)

        if result.face_landmarks:
            cx, cy, angle, scale = landmarks_to_transform(result.face_landmarks[0])
            frames.append({"t": t, "visible": True, "cx": cx, "cy": cy,
                            "angle": angle, "scale": scale})
        else:
            missing += 1
            frames.append({"t": t, "visible": False, "cx": None, "cy": None,
                            "angle": None, "scale": None})

        frame_idx += 1

    cap.release()
    landmarker.close()

    print(f"OK: {frame_idx} frames, {missing} sin cara detectada", file=sys.stderr)
    return frames, fps, width, height


def fill_and_smooth(frames: list[dict], window: int) -> None:
    """Sostiene el último transform visible en los huecos sin detección, y
    aplica un promedio móvil centrado para sacar el jitter cuadro a cuadro.
    El ángulo se unwrappea antes de promediar para no romper en el borde
    +-pi (si no, dos frames casi iguales pero a cada lado del borde
    promedian a un ángulo apuntando para el otro lado)."""
    last: dict | None = None
    for f in frames:
        if not f["visible"]:
            if last is None:
                continue
            f["cx"], f["cy"], f["angle"], f["scale"] = last["cx"], last["cy"], last["angle"], last["scale"]
        else:
            last = f

    if window <= 1 or not frames:
        return

    cx = np.array([f["cx"] or 0.0 for f in frames])
    cy = np.array([f["cy"] or 0.0 for f in frames])
    angle = np.unwrap(np.array([f["angle"] or 0.0 for f in frames]))
    scale = np.array([f["scale"] or 0.0 for f in frames])

    kernel = np.ones(window) / window
    def smooth(arr: np.ndarray) -> np.ndarray:
        pad = window // 2
        padded = np.pad(arr, pad, mode="edge")
        return np.convolve(padded, kernel, mode="valid")[: len(arr)]

    cx_s, cy_s, angle_s, scale_s = smooth(cx), smooth(cy), smooth(angle), smooth(scale)
    for i, f in enumerate(frames):
        if f["cx"] is None:
            continue
        f["cx"], f["cy"] = float(cx_s[i]), float(cy_s[i])
        f["angle"] = float((angle_s[i] + np.pi) % (2 * np.pi) - np.pi)
        f["scale"] = float(scale_s[i])


def write_preview(video_path: str, frames: list[dict], width: int, height: int, out_path: str) -> None:
    cap = cv2.VideoCapture(video_path)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    writer = cv2.VideoWriter(out_path, fourcc, fps, (width, height))

    for f in frames:
        ok, frame = cap.read()
        if not ok:
            break
        if f["cx"] is not None:
            center = (int(f["cx"] * width), int(f["cy"] * height))
            axes = (int(f["scale"] * width * 1.1), int(f["scale"] * width * 1.5))
            angle_deg = float(np.degrees(f["angle"]))
            color = (0, 255, 0) if f["visible"] else (0, 165, 255)  # naranja = sostenido, no detectado
            cv2.ellipse(frame, center, axes, angle_deg, 0, 360, color, 3)
        writer.write(frame)

    cap.release()
    writer.release()
    print(f"Preview escrito en {out_path}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrae la pista de posición/ángulo/escala de la cara en un video, para usar como slot de un template.")
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True, help="Ruta del JSON de salida")
    parser.add_argument("--preview", help="Si se pasa, escribe un mp4 con el óvalo dibujado para validar el tracking")
    parser.add_argument("--smooth-window", type=int, default=7, help="Tamaño de la ventana del promedio móvil (en frames); 1 desactiva el suavizado")
    args = parser.parse_args()

    frames, fps, width, height = extract_raw_track(args.video)
    fill_and_smooth(frames, args.smooth_window)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"video": args.video, "fps": fps, "width": width, "height": height, "frames": frames}, f)

    if args.preview:
        write_preview(args.video, frames, width, height, args.preview)


if __name__ == "__main__":
    main()
