import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

project_dir = Path(SPECPATH)
source_dir = project_dir / "src"
entry = project_dir / "entrypoint.py"
one_dir = os.environ.get("TYPEDANCE_PYINSTALLER_MODE") == "onedir"
show_console = one_dir or os.environ.get("TYPEDANCE_PYINSTALLER_CONSOLE") == "1"

datas = []
binaries = []
hiddenimports = collect_submodules("typedance_sidecar")

for package in ["fastapi", "playwright", "sharepoint2text", "uvicorn"]:
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

datas += collect_data_files("mcp")
hiddenimports += collect_submodules("mcp.server")

analysis = Analysis(
    [str(entry)],
    pathex=[str(source_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [] if one_dir else analysis.binaries,
    [] if one_dir else analysis.datas,
    [],
    name="typedance-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=show_console,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    exclude_binaries=one_dir,
)

if one_dir:
    bundle = COLLECT(
        exe,
        analysis.binaries,
        analysis.datas,
        strip=False,
        upx=True,
        name="typedance-sidecar",
    )
