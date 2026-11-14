"""Convert the approved XLSX into an operational import artifact, never a dev seed.
Usage: python scripts/prepare-owner-workbook.py INPUT.xlsx OUTPUT.json
Uses only the Python standard library. Monetary values are decimal strings.
"""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

source, destination = map(Path, sys.argv[1:])
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with ZipFile(source) as archive:
    strings = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", ns)] if "xl/sharedStrings.xml" in archive.namelist() else []
    book = ET.fromstring(archive.read("xl/workbook.xml"))
    relations = {item.attrib["Id"]: item.attrib["Target"] for item in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for sheet in book.findall("s:sheets/s:sheet", ns):
        target = relations[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
        target = target.lstrip("/") if target.startswith("/") else "xl/" + target
        rows = []
        for row in ET.fromstring(archive.read(target)).findall("s:sheetData/s:row", ns)[1:]:
            cells = {}
            for cell in row.findall("s:c", ns):
                value = cell.find("s:v", ns)
                value = value.text if value is not None else None
                if cell.attrib.get("t") == "s" and value is not None:
                    value = strings[int(value)]
                if cell.attrib.get("t") == "inlineStr":
                    value = "".join(cell.find("s:is", ns).itertext())
                cells["".join(char for char in cell.attrib["r"] if char.isalpha())] = value
            if any(value is not None for value in cells.values()):
                rows.append((int(row.attrib["r"]), cells))
        sheets[sheet.attrib["name"]] = rows
    products = [{"sourceRow": number, "name": row["A"], "stock": row.get("B"), "unit": row["C"], "price": row["D"], "material": row["E"], "labor": row["F"], "hpp": row["G"]} for number, row in sheets["Aktiva Lancar"]]
    assets = [{"sourceRow": number, "name": row["B"], "quantity": row["C"], "unit": row["D"], "cost": row["E"]} for number, row in sheets["Aktiva Tetap"]]
    assert len(products) == 34 and len(assets) == 20, "Unexpected worksheet row counts"
    for row in products:
        assert int(row["material"]) + int(row["labor"]) == int(row["hpp"]), "HPP mismatch"
    payload = {"sourceIdentity": "lokka-owner-assets-v1", "workbookHash": hashlib.sha256(source.read_bytes()).hexdigest(), "products": products, "assets": assets}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(products)} products and {len(assets)} assets; SHA-256 {payload['workbookHash']}")
