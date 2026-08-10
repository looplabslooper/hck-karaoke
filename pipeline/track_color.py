"""Extrae la pista de posición/ángulo/escala de la cara siguiendo un blob de
color saturado (ej. la capucha verde lima de los templates nuevos) en vez de
landmarks faciales. El template se diseñó a propósito con ese color exclusivo
en cuadro (ver .claude/agents/director-escenas.md) para que este tracking sea
confiable incluso con movimiento — a diferencia de track_face.py, acá no hace
falta reconocer una cara real, solo segmentar un color que no aparece en
ningún otro lugar del frame. No depende de mediapipe, solo OpenCV.

Reusa fill_and_smooth() y write_preview() de track_face.py (son genéricas,
no dependen de mediapipe) para no duplicar esa lógica."""
import argparse
import json
import sys

import cv2
import numpy as np

from track_face import fill_and_smooth, write_preview

# Rango HSV para el verde lima saturado pedido en el prompt del template.
# H en OpenCV va de 0-179; el verde lima cae aprox 35-85. S/V altos porque
# el prompt pidió una tela mate muy saturada, no un verde apagado.
DEFAULT_LOWER_HSV = (35, 70, 60)
DEFAULT_UPPER_HSV = (90, 255, 255)

# Ejes del óvalo relativos a `scale`, misma convención que track_face.py/
# compose_preview.py/template-editor.html.
AXIS_RATIO_Y = 1.5

MIN_AREA_FRACTION = 0.0008  # descarta blobs de ruido más chicos que esta fracción del área del frame


def extract_raw_track(video_path: str, lower_hsv, upper_hsv) -> tuple[list[dict], float, int, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"No se pudo abrir el video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    min_area = width * height * MIN_AREA_FRACTION
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))

    frames: list[dict] = []
    frame_idx = 0
    missing = 0
    # Una elipse es simétrica: fitEllipse no tiene forma de saber cuál de
    # los dos extremos del eje mayor es "arriba" (frente) y cuál es "abajo"
    # (mentón) — el ángulo que devuelve solo está definido módulo 180°. Sin
    # corregir esto, el lado elegido puede saltar entre frames sin ningún
    # movimiento real de la cabeza, y la foto pegada queda cabeza abajo a
    # ratos. Se resuelve por continuidad: de los dos ángulos posibles
    # (crudo y crudo+180°), se elige el que quede más cerca del ángulo ya
    # resuelto del frame anterior.
    prev_angle: float | None = None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = frame_idx / fps
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, lower_hsv, upper_hsv)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest = max(contours, key=cv2.contourArea) if contours else None

        if largest is not None and cv2.contourArea(largest) >= min_area:
            if len(largest) >= 5:
                (ex, ey), (minor_ax, major_ax), fit_angle_deg = cv2.fitEllipse(largest)
            else:
                (ex, ey), (rw, rh), fit_angle_deg = cv2.minAreaRect(largest)
                minor_ax, major_ax = min(rw, rh), max(rw, rh)
            cx, cy = ex / width, ey / height
            raw_angle = float(np.radians(fit_angle_deg)) % np.pi
            if prev_angle is None:
                angle = raw_angle
            else:
                candidates = (raw_angle, raw_angle + np.pi)
                angle = min(candidates, key=lambda c: abs((c - prev_angle + np.pi) % (2 * np.pi) - np.pi))
            prev_angle = angle
            scale = float((major_ax / 2) / (width * AXIS_RATIO_Y))
            frames.append({"t": t, "visible": True, "cx": cx, "cy": cy, "angle": angle, "scale": scale})
        else:
            missing += 1
            frames.append({"t": t, "visible": False, "cx": None, "cy": None, "angle": None, "scale": None})

        frame_idx += 1

    cap.release()

    # La continuidad frame a frame ya evita saltos de 180° a mitad de clip,
    # pero el primer frame visible fija el lado arbitrariamente — todo el
    # clip podría terminar consistentemente "boca abajo". Como la cabeza
    # está mayormente derecha la mayor parte de un baile normal, el promedio
    # circular de los ángulos resueltos tiene que quedar cerca de 0; si en
    # cambio queda cerca de ±180°, se corrigió el lado equivocado y se
    # rota toda la serie 180° de una vez.
    resolved = [f["angle"] for f in frames if f["visible"]]
    if resolved:
        mean_angle = float(np.arctan2(np.mean(np.sin(resolved)), np.mean(np.cos(resolved))))
        if abs(mean_angle) > np.pi / 2:
            for f in frames:
                if f["visible"]:
                    f["angle"] = float((f["angle"] + np.pi + np.pi) % (2 * np.pi) - np.pi)

    print(f"OK: {frame_idx} frames, {missing} sin blob de color detectado", file=sys.stderr)
    return frames, fps, width, height


def main() -> None:
    parser = argparse.ArgumentParser(description="Trackea un blob de color saturado (ej. capucha verde) para armar el slot de un template.")
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--preview", help="Si se pasa, escribe un mp4 con el óvalo dibujado para validar el tracking")
    parser.add_argument("--smooth-window", type=int, default=5)
    parser.add_argument("--lower-hsv", nargs=3, type=int, default=DEFAULT_LOWER_HSV, metavar=("H", "S", "V"))
    parser.add_argument("--upper-hsv", nargs=3, type=int, default=DEFAULT_UPPER_HSV, metavar=("H", "S", "V"))
    args = parser.parse_args()

    frames, fps, width, height = extract_raw_track(args.video, tuple(args.lower_hsv), tuple(args.upper_hsv))
    fill_and_smooth(frames, args.smooth_window)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"video": args.video, "fps": fps, "width": width, "height": height, "frames": frames}, f)

    if args.preview:
        write_preview(args.video, frames, width, height, args.preview)


if __name__ == "__main__":
    main()
