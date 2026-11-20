"""Build a local distribution preserving Windows newlines and Mac executable bits."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import stat

root = Path(__file__).resolve().parent
files = sorted((root / 'dist').rglob('*')) + [root / name for name in (
    'package.json', 'server.mjs', 'launch.mjs', '启动帧迹.cmd', '启动帧迹.command', 'README.md')]
out = root / 'artifacts' / '帧迹-Windows-Mac.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', compression=ZIP_DEFLATED) as archive:
    for source in files:
        if not source.is_file():
            continue
        data = source.read_bytes()
        if source.suffix == '.cmd':
            data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        elif source.suffix == '.command':
            data = data.replace(b'\r\n', b'\n')
        info = ZipInfo(source.relative_to(root).as_posix())
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | (0o755 if source.suffix == '.command' else 0o644)) << 16
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, data)
with ZipFile(out) as archive:
    assert archive.testzip() is None
    entry = archive.getinfo('启动帧迹.command')
    assert (entry.external_attr >> 16) & 0o777 == 0o755
    assert b'\r' not in archive.read(entry)
print(f'Verified package: {out}')
