"""Carga puntual de modelos de insightface, sin pasar por FaceAnalysis.

FaceAnalysis (usada antes acá) abre una sesión de ONNX Runtime para los 5
modelos del pack buffalo_l (detección, landmark_2d_106, landmark_3d_68,
genderage, recognition) y recién DESPUÉS de crear cada sesión descarta las que
no están en `allowed_modules` — con CUDA, crear una sesión implica compilar/
buscar el algoritmo óptimo por modelo (`cudnn_conv_algo_search: EXHAUSTIVE`),
así que ese descarte tardío no ahorra nada: el costo ya se pagó. Este pipeline
nunca necesita landmark_2d_106/landmark_3d_68/genderage (ver
analyze_template_face.py y render_singer_faceswap.py), así que acá se abre
sesión únicamente para los .onnx puntuales que hacen falta.
"""
import os

import insightface
from insightface.app.common import Face
from insightface.utils import ensure_available

PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]

# Nombres de archivo fijos del pack buffalo_l (confirmados corriendo
# FaceAnalysis una vez y mirando qué taskname le asigna a cada .onnx).
DETECTION_FILE = "det_10g.onnx"
RECOGNITION_FILE = "w600k_r50.onnx"


def _model_dir() -> str:
    return ensure_available("models", "buffalo_l", root="~/.insightface")


def _load(filename: str):
    return insightface.model_zoo.get_model(os.path.join(_model_dir(), filename), providers=PROVIDERS)


def make_detector(det_size):
    det = _load(DETECTION_FILE)
    det.prepare(ctx_id=0, input_size=det_size, det_thresh=0.5)
    return det


def make_recognizer():
    rec = _load(RECOGNITION_FILE)
    rec.prepare(ctx_id=0)
    return rec


def detect_faces(det, img) -> list[Face]:
    bboxes, kpss = det.detect(img, max_num=0, metric="default")
    faces = []
    for i in range(bboxes.shape[0]):
        kps = kpss[i] if kpss is not None else None
        faces.append(Face(bbox=bboxes[i, 0:4], kps=kps, det_score=bboxes[i, 4]))
    return faces
