"""Compare an exported 3MF with PrusaSlicer's --export-3mf round trip.

Run PrusaSlicer with --export-3mf --dont-arrange --save native.ini
--output native.3mf source.3mf (CLI saves settings separately).
Usage: python3 web/scripts/verify-prusa-roundtrip.py source.3mf native.3mf native.ini
"""

import sys
import math
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def snapshot(path, settings=None, keys=None):
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
            object_metadata = {m.attrib["key"]: m.attrib["value"] for m in obj.findall("metadata")}
            for volume in obj.findall("volume"):
                metadata = {m.attrib["key"]: m.attrib["value"] for m in volume.findall("metadata")}
                # Native saves omit default tool 1 on a painted object's volume.
                volumes.append((metadata["name"], metadata.get("extruder", object_metadata.get("extruder", "1")),
                                int(volume.attrib["lastid"]) - int(volume.attrib["firstid"]) + 1))
            objects.append(volumes)
        profiles = archive.read("Metadata/Slic3r_PE_layer_heights_profile.txt").decode().strip()
        if keys is None:
            keys = [key for key in (
                "filament_colour", "extruder_colour", "nozzle_diameter", "complete_objects",
                "bed_shape", "max_print_height", "extruder_clearance_radius",
                "extruder_clearance_height", "printer_settings_id", "printer_model",
                "printer_variant", "single_extruder_multi_material", "start_gcode", "end_gcode",
                "wipe_tower", "elefant_foot_compensation",
            ) if key in config]
        core = ET.fromstring(archive.read("3D/3dmodel.model"))
        ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
        resources = {obj.get("id"): obj for obj in core.findall("m:resources/m:object", ns)}

        def transform(point, value):
            t = list(map(float, value.split())) if value else [1,0,0,0,1,0,0,0,1,0,0,0]
            return [sum(point[j] * t[j * 3 + i] for j in range(3)) + t[9 + i] for i in range(3)]

        def points(object_id):
            obj = resources[object_id]
            result = [[float(vertex.get(axis)) for axis in ("x", "y", "z")]
                      for vertex in obj.findall("m:mesh/m:vertices/m:vertex", ns)]
            for component in obj.findall("m:components/m:component", ns):
                result.extend(transform(point, component.get("transform"))
                              for point in points(component.get("objectid")))
            return result

        bounds = []
        for item in core.findall("m:build/m:item", ns):
            vertices = [transform(point, item.get("transform")) for point in points(item.get("objectid"))]
            bounds.append(tuple(round(fn(p[i] for p in vertices), 3) for fn in (min, max) for i in range(3)))
        painting = sorted(triangle.get("mmu_segmentation", "") for triangle in core.iter()
                          if triangle.tag.endswith("}triangle"))
        return {key: config[key] for key in keys}, objects, profiles, bounds, painting


def equivalent(source, native):
    # Large bed offsets are serialized through native Float32 vertices. Allow
    # two micrometers of rounding in world bounds; settings/painting stay exact.
    return (source[:3] == native[:3] and source[4:] == native[4:]
            and len(source[3]) == len(native[3])
            and all(math.isclose(a, b, abs_tol=0.002) for left, right in zip(source[3], native[3])
                    for a, b in zip(left, right)))


if __name__ == "__main__":
    source = snapshot(sys.argv[1])
    native = snapshot(sys.argv[2], sys.argv[3], source[0].keys())
    assert equivalent(source, native), "PrusaSlicer changed configuration, volume assignments, geometry bounds, painting, or layer profiles"
    print(f"Verified {len(source[1])} objects: native configuration, slots, colors, world bounds, painting, and layer profiles preserved")
