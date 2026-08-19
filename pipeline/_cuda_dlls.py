"""Windows-only: los paquetes pip nvidia-cublas-cu12/nvidia-cudnn-cu12 (ver
pyproject.toml, extras `[cuda,cudnn]` de onnxruntime-gpu) traen sus DLLs
adentro de site-packages, pero a diferencia de Linux, Windows no las
encuentra solas — onnxruntime carga `onnxruntime_providers_cuda.dll`, que a
su vez depende de `cublasLt64_12.dll`/`cudnn64_9.dll`, y esa segunda carga
falla en silencio si esas carpetas no están en el PATH del proceso.
`os.add_dll_directory()` solo no alcanza acá (probado); hace falta además
anteponerlas a PATH. Sin este fix, onnxruntime cae a CPU sin ningún error
visible más que un log — se ve como "está corriendo bien" pero mucho más
lento.

Se importa (import side-effect, `register()`) antes de `onnxruntime`/
`insightface` en cualquier script de este pipeline que use el swap con GPU.
"""
import glob
import os
import sys


def register() -> None:
    if sys.platform != 'win32':
        return
    try:
        import nvidia
    except ImportError:
        return  # onnxruntime-gpu instalado sin los extras [cuda,cudnn] — cae a CPU normalmente

    dirs = []
    for pkg_dir in nvidia.__path__:
        for bin_dir in glob.glob(os.path.join(pkg_dir, '*', 'bin')):
            dirs.append(bin_dir)
            os.add_dll_directory(bin_dir)
    if dirs:
        os.environ['PATH'] = os.pathsep.join(dirs) + os.pathsep + os.environ.get('PATH', '')


register()
