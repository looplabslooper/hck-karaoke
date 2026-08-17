"""Prototipo offline: pega una foto sobre un video usando un transform.json
ya generado por track_face.py, para ver a ojo la calidad del compuesto antes
de portar esta misma lógica al compositor en vivo (canvas, apps/admin).
No es el compositor final — es solo para validar el approach."""
import argparse
import json
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision

from track_face import make_landmarker, landmarks_to_transform

# Misma proporción de ejes que usa write_preview() en track_face.py, para
# que el óvalo de corte de la foto tenga el mismo criterio que el óvalo que
# ya se veía en el preview de tracking.
AXIS_RATIO_X, AXIS_RATIO_Y = 1.1, 1.5
FEATHER_PX = 15


def detect_photo_transform(photo_bgr: np.ndarray) -> tuple[float, float, float, float]:
    landmarker = make_landmarker(vision.RunningMode.IMAGE)
    rgb = cv2.cvtColor(photo_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_image)
    landmarker.close()
    if not result.face_landmarks:
        sys.exit("No se detectó ninguna cara en la foto.")
    return landmarks_to_transform(result.face_landmarks[0])


def interpolate(frames_data: list[dict], t: float) -> dict | None:
    """Interpola cx/cy/angle/scale entre los dos keyframes más cercanos a t,
    sosteniendo el primero/último fuera de rango. Misma lógica que
    template-editor.html (que puede producir un transform.json disperso, a
    mano) y que el futuro compositor en vivo — así este script prueba el
    mismo camino que se va a usar de verdad, no uno más denso/artificial.

    `visible=False` marca un tramo sin detección confiable — track_color.py
    puede seguir escribiendo cx/cy ahí (arrastrados internamente), así que
    filtrar solo por "no es None" no alcanza: hay que exigir visible=True
    también, si no el óvalo salta a donde el tracker perdió la máscara."""
    frames = [f for f in frames_data if f["visible"] and f["cx"] is not None]
    if not frames:
        return None
    if t <= frames[0]["t"]:
        return frames[0]
    if t >= frames[-1]["t"]:
        return frames[-1]
    for a, b in zip(frames, frames[1:]):
        if a["t"] <= t <= b["t"]:
            span = b["t"] - a["t"] or 1.0
            f = (t - a["t"]) / span
            da = b["angle"] - a["angle"]
            da = (da + np.pi) % (2 * np.pi) - np.pi
            return {
                "cx": a["cx"] + (b["cx"] - a["cx"]) * f,
                "cy": a["cy"] + (b["cy"] - a["cy"]) * f,
                "angle": a["angle"] + da * f,
                "scale": a["scale"] + (b["scale"] - a["scale"]) * f,
            }
    return frames[-1]


def build_cutout(photo_bgr: np.ndarray, cx: float, cy: float, angle: float, scale: float) -> np.ndarray:
    """BGRA: la foto entera, con alpha en forma de óvalo centrado en la cara
    y emplumado en el borde (mismo look que ovalMaskCutout() de
    karaoke-walk.html, pero calculado a partir del transform en vez de un
    recorte fijo)."""
    h, w = photo_bgr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    center = (int(cx * w), int(cy * h))
    axes = (int(scale * w * AXIS_RATIO_X), int(scale * w * AXIS_RATIO_Y))
    cv2.ellipse(mask, center, axes, float(np.degrees(angle)), 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), FEATHER_PX)
    return cv2.merge([photo_bgr[:, :, 0], photo_bgr[:, :, 1], photo_bgr[:, :, 2], mask])


def main() -> None:
    parser = argparse.ArgumentParser(description="Pega una foto sobre un video usando un transform.json (prototipo offline).")
    parser.add_argument("--video", required=True)
    parser.add_argument("--transform", required=True, help="transform.json generado por track_face.py")
    parser.add_argument("--photo", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    with open(args.transform, "r", encoding="utf-8") as f:
        transform = json.load(f)
    frames_data = transform["frames"]

    photo = cv2.imread(args.photo)
    if photo is None:
        sys.exit(f"No se pudo leer la foto: {args.photo}")
    photo_h, photo_w = photo.shape[:2]
    photo_cx, photo_cy, photo_angle, photo_scale = detect_photo_transform(photo)
    cutout = build_cutout(photo, photo_cx, photo_cy, photo_angle, photo_scale)
    photo_center_px = (photo_cx * photo_w, photo_cy * photo_h)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"No se pudo abrir el video: {args.video}")
    # Se usan las dimensiones/fps reales del video abierto, no lo declarado en
    # transform.json (que en un template armado a mano es solo informativo) —
    # cx/cy/scale ya vienen normalizados, así que no dependen de que coincidan.
    video_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    video_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, fps, (video_w, video_h))

    pasted = 0
    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        f = interpolate(frames_data, frame_idx / fps)
        if f is not None:
            scale_factor = (f["scale"] * video_w) / (photo_scale * photo_w)
            rotation_deg = -np.degrees(f["angle"] - photo_angle)
            M = cv2.getRotationMatrix2D(photo_center_px, rotation_deg, scale_factor)
            target_px = (f["cx"] * video_w, f["cy"] * video_h)
            M[0, 2] += target_px[0] - photo_center_px[0]
            M[1, 2] += target_px[1] - photo_center_px[1]
            warped = cv2.warpAffine(cutout, M, (video_w, video_h), borderValue=(0, 0, 0, 0))
            alpha = warped[:, :, 3:4].astype(np.float32) / 255.0
            frame = (frame.astype(np.float32) * (1 - alpha) + warped[:, :, :3].astype(np.float32) * alpha).astype(np.uint8)
            pasted += 1
        writer.write(frame)
        frame_idx += 1

    cap.release()
    writer.release()
    print(f"OK: {pasted}/{frame_idx} frames con foto pegada. Escrito en {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
