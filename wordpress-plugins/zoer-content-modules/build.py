from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).parent
target = root / 'dist' / 'zoer-content-modules-0.1.3.zip'
target.parent.mkdir(exist_ok=True)
files = ['zoer-content-modules.php', 'includes/package.php', 'block.json', 'block.js', 'admin.js', 'style.css', 'admin.css', 'README.md']
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        info = zipfile.ZipInfo('zoer-content-modules/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
target.with_suffix('.zip.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + target.name + '\n')
print(target)
