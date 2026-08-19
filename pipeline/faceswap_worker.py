"""Worker persistente del face swap: arranca una sola vez, carga los tres
modelos de insightface (detector, reconocedor, swapper) en la GPU y se queda
vivo atendiendo trabajos por stdin — así ni analyze_template_face.py ni
render_singer_faceswap.py tienen que volver a crear sesión de ONNX Runtime
(la parte lenta: incluye una búsqueda "exhaustiva" de algoritmo CUDA la
primera vez que corre cada sesión) por cada template/cantante nuevo. El server
Node (apps/server/src/sync/faceSwapWorker.ts) le habla en vez de spawnear un
proceso nuevo por trabajo.

Protocolo: una línea JSON por trabajo en stdin, una línea JSON de respuesta
por stdout — nunca al revés (nada de leer varias líneas por trabajo ni
mandar más de una respuesta). Ver faceSwapWorker.ts para el detalle de los
mensajes.
"""
import json
import os
import sys
import threading
import time

import _cuda_dlls  # noqa: F401  (side effect: registra las DLLs de CUDA en Windows antes de onnxruntime)

# insightface/onnxruntime imprimen algunas líneas de diagnóstico por stdout
# durante la construcción de sesión (confirmado leyendo su código: p.ej.
# ModelRouter.get_model's "Applied providers: ..." e INSwapper's
# "inswapper-shape: ..."), y eso rompería el framing del protocolo NDJSON si
# se colara en el mismo canal que usamos para hablarle a Node. Redirigimos
# stdout a stderr mientras se arman los modelos y lo restauramos recién antes
# del handshake — nada de esto corre de nuevo durante un trabajo (verificado:
# los tres modelos se arman una sola vez acá, render()/analyze() no crean
# sesiones nuevas), así que no hace falta repetir la redirección más abajo.
_real_stdout = sys.stdout
sys.stdout = sys.stderr

import _insight_lite  # noqa: E402
import analyze_template_face  # noqa: E402
import render_singer_faceswap  # noqa: E402

DET_SIZE = (640, 640)

# Respaldo independiente del timeout de inactividad que maneja Node
# (faceSwapWorker.ts, 10 min): si Node muere sin avisarle (crash, kill -9, o
# cualquier otra forma en que no llegue a cerrarle el stdin prolijamente),
# este worker igual se apaga solo — no se puede confiar en que algo externo
# siempre le va a avisar. El doble del timeout de Node da margen de sobra
# para no pisarse con un apagado prolijo normal.
IDLE_SHUTDOWN_SECONDS = 20 * 60

_last_activity = time.monotonic()
_last_activity_lock = threading.Lock()


def _touch_activity() -> None:
    global _last_activity
    with _last_activity_lock:
        _last_activity = time.monotonic()


def _idle_watchdog() -> None:
    while True:
        time.sleep(30)
        with _last_activity_lock:
            idle_for = time.monotonic() - _last_activity
        if idle_for >= IDLE_SHUTDOWN_SECONDS:
            print(f"[faceswap_worker] {idle_for:.0f}s sin actividad, autoapagado de respaldo", file=sys.stderr)
            os._exit(0)  # salida dura: no hay nada que limpiar (sin trabajo en curso) y evita depender de que stdin se desbloquee solo


def build_models():
    # Detector compartido entre los dos tipos de trabajo (analyze y swap) —
    # ambos scripts lo arman hoy con los mismos parámetros (DET_SIZE 640x640),
    # así que una sola instancia alcanza para los dos y ahorra una sesión más.
    detector = _insight_lite.make_detector(DET_SIZE)
    recognizer = _insight_lite.make_recognizer()
    swapper = render_singer_faceswap.make_swapper()
    return detector, recognizer, swapper


def handle_job(job: dict, detector, recognizer, swapper) -> dict:
    op = job.get("op")
    if op == "analyze":
        analyze_template_face.analyze(job["video"], job["out"], detector)
        return {"id": job["id"], "ok": True}
    if op == "swap":
        swap_passes = job.get("swapPasses", render_singer_faceswap.SWAP_PASSES)
        render_singer_faceswap.render(
            job["video"], job["analysis"], job["sourcePhoto"], job["out"],
            detector, recognizer, swapper, swap_passes=swap_passes,
        )
        return {"id": job["id"], "ok": True}
    raise ValueError(f"op desconocido: {op!r}")


def main() -> None:
    detector, recognizer, swapper = build_models()

    sys.stdout = _real_stdout
    print(json.dumps({"type": "ready", "pid": os.getpid()}), flush=True)

    _touch_activity()
    threading.Thread(target=_idle_watchdog, daemon=True).start()

    for raw_line in sys.stdin:
        _touch_activity()
        line = raw_line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except json.JSONDecodeError as err:
            print(f"[faceswap_worker] línea no es JSON válido, se ignora: {err}", file=sys.stderr)
            continue

        job_id = job.get("id")
        try:
            response = handle_job(job, detector, recognizer, swapper)
        except Exception as err:  # nunca dejamos que un trabajo se lleve puesto el worker entero
            response = {"id": job_id, "ok": False, "error": str(err), "errorType": type(err).__name__}
            print(f"[faceswap_worker] trabajo {job_id} falló: {err}", file=sys.stderr)

        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
