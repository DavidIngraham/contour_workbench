"""Native Orca import/save/slice verification, without arrangement or printing.

Usage: python3 web/scripts/verify-orca-exports.py --slicer PATH source.3mf [...]
Use the Linux CLI with its runtime libraries on LD_LIBRARY_PATH when necessary.
Reports, native projects and G-code stay beside the source in native-verification.
"""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile

NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
PRODUCTION = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"


def metadata(node):
    return {m.get("key"): m.get("value") for m in node.findall("metadata")}


def transform(point, value):
    t = list(map(float, value.split())) if value else [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    return [sum(point[j] * t[j * 3 + i] for j in range(3)) + t[9 + i] for i in range(3)]


def snapshot(path):
    with ZipFile(path) as archive:
        config = json.loads(archive.read("Metadata/project_settings.config"))
        model = ET.fromstring(archive.read("Metadata/model_settings.config"))
        root_path = "3D/3dmodel.model"
        roots = {root_path: ET.fromstring(archive.read(root_path))}

        def geometry(file, object_id):
            if file not in roots:
                roots[file] = ET.fromstring(archive.read(file))
            obj = next(o for o in roots[file].findall("m:resources/m:object", NS)
                       if o.get("id") == object_id)
            points = [[float(v.get(axis)) for axis in ("x", "y", "z")]
                      for v in obj.findall("m:mesh/m:vertices/m:vertex", NS)]
            paint = Counter(t.get("paint_color", "") for t in obj.findall("m:mesh/m:triangles/m:triangle", NS))
            for component in obj.findall("m:components/m:component", NS):
                child_file = component.get(f"{{{PRODUCTION}}}path", file).lstrip("/")
                child_points, child_paint = geometry(child_file, component.get("objectid"))
                points.extend(transform(p, component.get("transform")) for p in child_points)
                paint.update(child_paint)
            return points, paint

        settings = {o.get("id"): metadata(o) for o in model.findall("object")}
        profiles = {}
        for line in archive.read("Metadata/layer_heights_profile.txt").decode().splitlines():
            match = re.fullmatch(r"object_id=(\d+)\|(.+)", line)
            if match:
                profiles[int(match[1])] = list(map(float, match[2].split(";")))
        objects = {}
        for i, item in enumerate(roots[root_path].findall("m:build/m:item", NS)):
            object_id = item.get("objectid")
            points, paint = geometry(root_path, object_id)
            world = [transform(p, item.get("transform")) for p in points]
            name = settings[object_id]["name"]
            objects[name] = {"extruder": settings[object_id].get("extruder", "1"),
                             "triangles": sum(paint.values()), "painting": dict(paint),
                             "bounds_mm": [fn(p[a] for p in world) for fn in (min, max) for a in range(3)],
                             "layer_profile": profiles.get(i + 1)}
        plates = [{"id": metadata(p)["plater_id"],
                   "sequence": metadata(p).get("print_sequence", config["print_sequence"]),
                   "objects": [settings[metadata(instance)["object_id"]]["name"]
                               for instance in p.findall("model_instance")]}
                  for p in model.findall("plate")]
        # Native saves canonicalize deprecated stock clearance keys and scalar vectors.
        config["extruder_clearance_radius"] = config.get("extruder_clearance_max_radius", config.get("extruder_clearance_radius"))
        keys = ("printer_settings_id", "printer_model", "printer_variant", "printable_area",
                "printable_height", "extruder_clearance_radius", "extruder_clearance_height_to_rod",
                "nozzle_diameter", "machine_start_gcode", "machine_end_gcode", "filament_ids",
                "filament_settings_id", "filament_colour", "nozzle_temperature_initial_layer",
                "print_sequence", "enable_prime_tower", "wall_loops", "sparse_infill_density", "initial_layer_line_width",
                "elefant_foot_compensation", "wipe_tower_x", "wipe_tower_y", "extruder_offset", "curr_bed_type", "wipe_tower_type", "wipe_tower_wall_type")
        selected = {key: config[key] if isinstance(config[key], list) else [config[key]]
                    for key in keys if key in config}
        return selected, objects, plates


def coupon_heights(gcode, legend, origin, offsets):
    x = y = z = e = 0.0
    tool, feature, relative = 0, "", False
    heights = {"lines": [0.0] * 3, "patches": [0.0] * 3}
    for line in gcode.splitlines():
        if line.startswith("; FEATURE:"):
            feature = line.split(":", 1)[1].strip()
        command = line.split(";", 1)[0].strip()
        if command == "M83":
            relative = True
        elif command == "M82":
            relative = False
        elif re.fullmatch(r"T\d+", command):
            tool = int(command[1:])
        params = {k: float(v) for k, v in re.findall(r"([XYZE])(-?(?:\d+(?:\.\d*)?|\.\d+))", command)}
        if command.startswith("G92"):
            e = params.get("E", e)
        if not re.match(r"G[01] ", command):
            continue
        nx, ny = params.get("X", x), params.get("Y", y)
        z = params.get("Z", z)
        amount = params.get("E", 0) if relative else params.get("E", e) - e
        if "E" in params:
            e = e + amount if relative else params["E"]
        dx, dy = offsets[min(tool, len(offsets) - 1)]
        mx, my = (x + nx) / 2 - origin[0] + dx, (y + ny) / 2 - origin[1] + dy
        if amount > 0 and feature in ("Outer wall", "Inner wall", "Top surface", "Internal solid infill"):
            for row in range(3):
                center_y = 9 + row * 12
                if tool == 2 and 48 <= mx <= 56 and abs(my - center_y) <= 3:
                    heights["patches"][row] = max(heights["patches"][row], z)
                if tool == 1 and 3 <= mx <= 44 and abs(my - center_y) <= 0.6:
                    heights["lines"][row] = max(heights["lines"][row], z)
        x, y = nx, ny
    targets = [legend["base_height_mm"] + offset for offset in legend["rows_front_to_back_offset_mm"]]
    for region, measured in heights.items():
        assert all(abs(a - b) <= 0.2 for a, b in zip(measured, targets)), (region, measured, targets)
    return heights


def verify(slicer, source):
    work = source.parent / "native-verification" / source.stem
    work.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([str(slicer), "--datadir", str(work / "config"),
                             "--arrange", "0", "--orient", "0", "--slice", "0",
                             "--export-3mf", "native.3mf", "--outputdir", str(work), str(source)],
                            capture_output=True, text=True)
    (work / "slicer.log").write_text(result.stdout + result.stderr)
    assert result.returncode == 0, f"Native Orca failed ({result.returncode}); see {work / 'slicer.log'}"
    source_config, original, plates = snapshot(source)
    native_config, saved, native_plates = snapshot(work / "native.3mf")
    assert all(v == native_config.get(k) for k, v in source_config.items()), {k: (v, native_config.get(k)) for k, v in source_config.items() if v != native_config.get(k)}
    assert set(original) == set(saved), "Native round trip omitted objects"
    for name, obj in original.items():
        native_obj = saved[name]
        assert all(math.isclose(a, b, abs_tol=0.002) for a, b in zip(obj["bounds_mm"], native_obj["bounds_mm"])), (name, "world bounds changed")
        assert {k: v for k, v in obj.items() if k != "bounds_mm"} == {k: v for k, v in native_obj.items() if k != "bounds_mm"}, (name, "mesh, painting, tool or adaptive profile changed")
    assert plates == native_plates, "Native round trip changed plate ownership or print sequence"
    with ZipFile(source) as archive:
        manifest = json.loads(archive.read("Metadata/contour_workbench.json"))
        legend = json.loads(archive.read("Metadata/multicolor_coupon.json")) if "Metadata/multicolor_coupon.json" in archive.namelist() else None
    results = []
    with ZipFile(work / "native.3mf") as archive:
        info = ET.fromstring(archive.read("Metadata/slice_info.config"))
        for plate, expected in zip(info.findall("plate"), plates, strict=True):
            plate_id = metadata(plate)["index"]
            sliced = plate.findall("object")
            assert len(sliced) == len(expected["objects"]) and all(o.get("skipped") == "false" for o in sliced), "Native slicing skipped objects"
            gcode = archive.read(f"Metadata/plate_{plate_id}.gcode").decode()
            assert "generated by OrcaSlicer 2.4.2" in gcode
            assert "G28" in gcode and "M109" in gcode, "Missing stock startup heating/homing"
            assert re.search(r"^;\s*(?:LAYER_CHANGE|CHANGE_LAYER|Z_HEIGHT:)", gcode, re.M), "No printable layers"
            order = []
            for name in re.findall(r"^; printing object (.+) id:\d+ copy \d+$", gcode, re.M):
                if not order or order[-1] != name:
                    order.append(name)
            assert set(order) == set(expected["objects"]), "Missing object extrusion labels"
            if expected["sequence"] == "by object":
                assert len(order) == len(expected["objects"]), "Sequential objects interleaved"
            used = {int(f.get("id")) for f in plate.findall("filament") if float(f.get("used_g")) > 0}
            tools = set()
            for name in expected["objects"]:
                painted = {code for code in original[name]["painting"] if code}
                if not painted:
                    tools.add(int(original[name]["extruder"]))
                for code in original[name]["painting"]:
                    if code:
                        tools.add((int(code[:-1], 16) + 3) if code.endswith("C") else int(code, 16) // 4)
            if not legend:
                assert used == tools, (used, tools)
            else:
                assert used == {1, 2, 3}, "Painted coupon omitted a filament"
            if manifest["material_mode"] == "manual":
                assert not re.search(r"^T[1-9]\d*\b", gcode, re.M), "Manual print selected an automatic tool"
            results.append({"plate": int(plate_id), "objects": len(expected["objects"]),
                            "print_sequence": expected["sequence"], "filaments_used": sorted(used),
                            "skipped_objects": [], **({"coupon_region_heights_mm": coupon_heights(gcode, legend, next(iter(original.values()))["bounds_mm"][:2], [tuple(map(float, v.split('x'))) for v in native_config["extruder_offset"]])} if legend else {})})
    report = {"source": source.name, "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "slicer": "OrcaSlicer 2.4.2", "native_roundtrip": True,
              "objects": len(original), "plates": results}
    (work / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Verified {source.name}: {len(original)} objects, {len(results)} plates, zero skipped objects", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slicer", type=Path, required=True)
    parser.add_argument("sources", type=Path, nargs="+")
    args = parser.parse_args()
    for source in args.sources:
        verify(args.slicer.resolve(), source.resolve())
