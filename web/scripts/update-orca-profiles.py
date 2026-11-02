"""Resolve OrcaSlicer 2.4.2 stock PLA profiles, verifying every source blob.

Usage: python3 web/scripts/update-orca-profiles.py [resources/profiles directory]
Without a local directory, files are downloaded from the pinned upstream tree.
"""

import hashlib
from functools import cache
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request

TREE = "8500fcdccaa10b5099ac20d252af3a7c560046f1"
ROOT = "https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/" + TREE + "/resources/profiles/"


def main():
    local = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    tree = json.load(urllib.request.urlopen(
        f"https://api.github.com/repos/OrcaSlicer/OrcaSlicer/git/trees/{TREE}?recursive=1"))
    hashes = {e["path"].removeprefix("resources/profiles/"): e["sha"]
              for e in tree["tree"] if e["path"].startswith("resources/profiles/")}
    sources = {}

    @cache
    def read(path):
        data = (local / path).read_bytes() if local else urllib.request.urlopen(
            ROOT + urllib.parse.quote(path)).read()
        # Windows portable distributions use CRLF; Git stores the same JSON as LF.
        data = data.replace(b"\r\n", b"\n")
        digest = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
        if hashes.get(path) != digest:
            raise ValueError(f"Profile differs from the pinned upstream source: {path}")
        sources[path] = digest
        return json.loads(data.decode("utf-8-sig"))

    catalogs = {vendor: read(vendor + ".json") for vendor in ("BBL", "Prusa")}

    def flatten(vendor, kind, name, chain=()):
        key = f"{vendor}/{kind}/{name}"
        if key in chain:
            raise ValueError(f"Cyclic inheritance: {key}")
        entry = next(e for e in catalogs[vendor][kind + "_list"] if e["name"] == name)
        own = dict(read(vendor + "/" + entry["sub_path"]))
        parent = own.pop("inherits", "")
        return {**(flatten(vendor, kind, parent, (*chain, key)) if parent else {}), **own}

    profiles = {}
    names = {"p1s": "Bambu Lab P1S", "x1c": "Bambu Lab X1 Carbon",
             "a1": "Bambu Lab A1", "a1-mini": "Bambu Lab A1 mini",
             "mk4s": "Prusa MK4S", "core-one": "Prusa CORE One"}
    metadata = {"type", "name", "from", "setting_id", "instantiation", "version",
                "inherits", "description", "filament_id", "renamed_from"}
    for printer_id, name in names.items():
        vendor = "Prusa" if printer_id in ("mk4s", "core-one") else "BBL"
        for entry in catalogs[vendor]["machine_list"]:
            machine_name = entry["name"]
            if not machine_name.startswith(name + " ") or not machine_name.endswith(" nozzle"):
                continue
            variant = machine_name[len(name) + 1:-len(" nozzle")].replace(" ", "")
            if variant not in ("0.2", "0.25", "0.3", "0.4", "0.5", "0.6", "0.8",
                               "HF0.4", "HF0.5", "HF0.6", "HF0.8"):
                continue
            machine = flatten(vendor, "machine", machine_name)
            print_name = machine["default_print_profile"]
            filament_name = machine["default_filament_profile"]
            if isinstance(filament_name, list):
                filament_name = filament_name[0]
            process = flatten(vendor, "process", print_name)
            filament = flatten(vendor, "filament", filament_name)

            def clean(config):
                return {k: v for k, v in config.items() if k not in metadata
                        and not k.startswith(("compatible_", "default_", "print_host", "printhost_"))
                        and k not in ("host_type", "serial_port", "serial_speed")}

            profiles[f"{printer_id}/{variant}"] = {
                "machine": clean(machine), "process": clean(process), "filament": clean(filament),
                "printer_settings_id": machine_name, "print_settings_id": print_name,
                "filament_settings_id": filament_name,
                "filament_id": filament.get("filament_id", ""),
            }
    target = Path(__file__).resolve().parents[1] / "src/orca-profiles.json"
    target.write_text(json.dumps({"version": "2.4.2", "source": ROOT, "tree": TREE,
                                  "source_blobs": dict(sorted(sources.items())),
                                  "profiles": profiles}, indent=2) + "\n")
    print(f"Wrote {len(profiles)} verified native baselines to {target}")


if __name__ == "__main__":
    main()
