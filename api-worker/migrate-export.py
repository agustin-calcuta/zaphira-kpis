"""Convert a private Apps Script export to D1 SQL without printing its contents.

Usage: python3 migrate-export.py PRIVATE_EXPORT_JSON PRIVATE_OUTPUT_SQL
The output contains password hashes and the sales dataset. Keep it outside Git.
"""
import json
import os
import sys
from pathlib import Path


def quote(value):
    return "'" + str(value if value is not None else "").replace("'", "''") + "'"


source, target = map(Path, sys.argv[1:3])
data = json.loads(source.read_text())
if not data.get("ok") or not data.get("users") or not data.get("dataset"):
    raise SystemExit("Incomplete migration export")

lines = []
for row in data["users"]:
    columns = ("usuario", "nombre", "rol", "vendedora", "hash", "salt", "cambiar", "activo", "ultimo_ingreso")
    values = []
    for col in columns:
        value = row.get(col, "")
        if col in ("cambiar", "activo"):
            values.append("1" if str(value).lower() in ("true", "1") else "0")
        else:
            values.append(quote(value))
    lines.append(f"INSERT OR REPLACE INTO users ({','.join(columns)}) VALUES ({','.join(values)});")

for row in data["objectives"]:
    mes = str(row.get("mes", ""))[:7]
    lines.append("INSERT OR REPLACE INTO objetivos (mes, alcance, objetivo) VALUES "
                 f"({quote(mes)},{quote(row.get('alcance'))},{float(row.get('objetivo') or 0)});")

dataset = data["dataset"]
snapshot = json.loads(dataset)
lines.append("DELETE FROM dataset;")
for index, start in enumerate(range(0, len(dataset), 7000)):
    chunk = dataset[start:start + 7000]
    lines.append("INSERT INTO dataset (id, payload, updated_at) VALUES "
                 f"({index},{quote(chunk)},datetime('now'));")
usd = {"usd": {"venta": snapshot.get("rate", 0), "fuente": snapshot.get("usdFuente", ""),
               "fecha": snapshot.get("usdFecha", "")},
       "usdMon": snapshot.get("rateMon", {}),
       "usdDay": {"from": snapshot.get("meta", {}).get("day0", ""),
                  "v": snapshot.get("rateDay", [])}}
lines.append("INSERT OR REPLACE INTO usd_cache (id,payload,updated_at) VALUES "
             f"(1,{quote(json.dumps(usd, ensure_ascii=False))},0);")
target.write_text("\n".join(lines) + "\n")
os.chmod(target, 0o600)
print(f"Prepared {len(data['users'])} users, {len(data['objectives'])} objectives, "
      f"and {len(dataset.encode())} dataset bytes")
