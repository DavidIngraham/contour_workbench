"""Compare an exported 3MF with PrusaSlicer's --export-3mf round trip.

Run PrusaSlicer with --export-3mf --dont-arrange --save native.ini
--output native.3mf source.3mf (CLI saves settings separately).
Usage: python3 web/scripts/verify-prusa-roundtrip.py source.3mf native.3mf native.ini
"""

import sys
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def snapshot(path, settings=None):
    with ZipFile(path) as archive:
        text = Path(settings).read_text() if settings else archive.read("Metadata/Slic3r_PE.config").decode()
        config = dict(
            line.removeprefix("; ").split(" = ", 1)
            for line in text.splitlines()
            if " = " in line
        )
        model = ET.fromstring(archive.read("Metadata/Slic3r_PE_model.config"))
        objects = []
        for obj in model.findall("object"):
            volumes = []
            for volume in obj.findall("volume"):
                metadata = {m.attrib["key"]: m.attrib["value"] for m in volume.findall("metadata")}
                volumes.append((metadata["name"], metadata["extruder"],
                                int(volume.attrib["lastid"]) - int(volume.attrib["firstid"]) + 1))
            objects.append(volumes)
        profiles = archive.read("Metadata/Slic3r_PE_layer_heights_profile.txt").decode().strip()
        return {key: config[key] for key in ("filament_colour", "extruder_colour", "nozzle_diameter")}, objects, profiles


source = snapshot(sys.argv[1])
native = snapshot(sys.argv[2], sys.argv[3])
assert source == native, "PrusaSlicer changed palettes, volume assignments, triangle counts, or layer profiles"
print(f"Verified {len(source[1])} objects: filament slots, colors, geometry counts, and layer profiles preserved")
