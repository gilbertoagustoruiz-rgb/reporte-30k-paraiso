"""Regenera public/index.html a partir de src/template.html y src/estructura.json."""
from pathlib import Path
root = Path(__file__).parent
t = (root / "src/template.html").read_text(encoding="utf8")
e = (root / "src/estructura.json").read_text(encoding="utf8")
(root / "public/index.html").write_text(t.replace("__ESTRUCTURA__", e), encoding="utf8")
print("public/index.html actualizado")
