"""Round-trip and slice every bed using a real PrusaSlicer 2.9+ CLI.

Usage: python3 web/scripts/verify-prusa-exports.py --slicer PATH source.3mf [...]
Windows portable CLIs are supported from WSL. Results stay beside each source
in a native-verification subdirectory. No printing or upload is performed.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
ET.register_namespace("", NS)
ET.register_namespace("slic3rpe", "http://schemas.slic3r.org/3mf/2017/06")
roundtrip = runpy.run_path(str(Path(__file__).with_name("verify-prusa-roundtrip.py")))
snapshot, equivalent = roundtrip["snapshot"], roundtrip["equivalent"]


def one_bed(source, target, manifest, plate):
    """Keep one native bed and translate it to bed zero without rearranging it."""
    with ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    core = ET.fromstring(files["3D/3dmodel.model"])
    build = core.find(f"{{{NS}}}build")
    offset = sum(len(p["objects"]) for p in manifest["plates"] if p["plate"] < plate["plate"])
    indices = range(offset, offset + len(plate["objects"]))
    selected = []
    for i, item in enumerate(list(build)):
        if i not in indices:
            build.remove(item)
            continue
        values = list(map(float, item.get("transform", "1 0 0 0 1 0 0 0 1 0 0 0").split()))
        values[9] -= (plate["plate"] - 1) * manifest["bed_size_mm"][0] * 1.2
        item.set("transform", " ".join(map(str, values)))
        selected.append(item.get("objectid"))
    resources = core.find(f"{{{NS}}}resources")
    objects = {obj.get("id"): obj for obj in resources if obj.tag.endswith("}object")}
    required = set()

    def retain(object_id):
        if object_id in required:
            return
        required.add(object_id)
        for child in objects[object_id].findall(f"{{{NS}}}components/{{{NS}}}component"):
            retain(child.get("objectid"))

    for object_id in selected:
        retain(object_id)
    for object_id, obj in objects.items():
        if object_id not in required:
            resources.remove(obj)
    files["3D/3dmodel.model"] = ET.tostring(core, encoding="utf-8", xml_declaration=True)
    settings = ET.fromstring(files["Metadata/Slic3r_PE_model.config"])
    for obj in list(settings):
        if obj.get("id") not in selected:
            settings.remove(obj)
    files["Metadata/Slic3r_PE_model.config"] = ET.tostring(settings)
    profiles = files["Metadata/Slic3r_PE_layer_heights_profile.txt"].decode().splitlines()
    files["Metadata/Slic3r_PE_layer_heights_profile.txt"] = "".join(
        f"object_id={i + 1}|{profiles[j].split('|', 1)[1]}\n" for i, j in enumerate(indices)
    ).encode()
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)


def check_filaments(bed_source, gcode, legend):
    """Check real filament consumption and the printed heights of coupon regions."""
    with ZipFile(bed_source) as archive:
        model = ET.fromstring(archive.read("3D/3dmodel.model"))
        metadata = ET.fromstring(archive.read("Metadata/Slic3r_PE_model.config"))
    expected = {int(node.get("value")) - 1 for node in metadata.iter()
                if node.get("key") == "extruder"}
    for triangle in model.iter():
        code = triangle.get("mmu_segmentation")
        if code:
            expected.add((int(code[:-1], 16) + 3 if code.endswith("C") else int(code, 16) // 4) - 1)
    usage = re.search(r"^; filament used \[mm\] = (.+)$", gcode, re.M)
    assert usage, "No filament consumption recorded"
    consumed = [float(value) for value in usage[1].split(",")]
    assert all(consumed[tool] > 0 for tool in expected), "A mapped filament was not printed"
    if legend:
        x = y = z = e = 0.0
        tool, feature, relative = 0, "", False
        heights = {"lines": [0.0] * 3, "patches": [0.0] * 3}
        for line in gcode.splitlines():
            if line.startswith(";TYPE:"):
                feature = line[6:]
            command = line.split(";", 1)[0].strip()
            if command == "M83":
                relative = True
            elif command == "M82":
                relative = False
            elif re.fullmatch(r"T\d+", command):
                tool = int(command[1:])
            params = {key: float(value) for key, value in re.findall(r"([XYZE])(-?(?:\d+(?:\.\d*)?|\.\d+))", command)}
            if command.startswith("G92"):
                e = params.get("E", e)
            if not re.match(r"G[01] ", command):
                continue
            nx, ny = params.get("X", x), params.get("Y", y)
            z = params.get("Z", z)
            amount = params.get("E", 0) if relative else params.get("E", e) - e
            if "E" in params:
                e = e + amount if relative else params["E"]
            mx, my = (x + nx) / 2, (y + ny) / 2
            if amount > 0 and feature in ("Perimeter", "External perimeter", "Solid infill", "Top solid infill"):
                for row in range(3):
                    center_y = 9 + row * 12
                    if tool == 2 and 48 <= mx <= 56 and abs(my - center_y) <= 3:
                        heights["patches"][row] = max(heights["patches"][row], z)
                    if tool == 1 and 3 <= mx <= 44 and abs(my - center_y) <= 0.6:
                        heights["lines"][row] = max(heights["lines"][row], z)
            x, y = nx, ny
        targets = [legend["base_height_mm"] + offset for offset in legend["rows_front_to_back_offset_mm"]]
        for region, measured in heights.items():
            assert all(abs(actual - target) <= 0.2 for actual, target in zip(measured, targets)), (region, measured, targets)
        return {"filament_mm": consumed, "coupon_region_heights_mm": heights}
    return {"filament_mm": consumed}


def verify(slicer, source, reuse_slices=False):
    work = source.parent / "native-verification" / source.stem
    work.mkdir(parents=True, exist_ok=True)
    windows = slicer.suffix.lower() == ".exe"

    def cli_path(path):
        path = str(path.resolve())
        if windows and os.name != "nt":
            return subprocess.check_output(["wslpath", "-w", path], text=True).strip()
        return path

    def run(*args):
        result = subprocess.run([str(slicer), "--datadir", cli_path(work / "config"), *args],
                                capture_output=True, text=True)
        with (work / "slicer.log").open("a") as log:
            log.write(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result.stdout

    version_match = re.search(r"PrusaSlicer[- ](\d+\.\d+\.\d+(?:[-.]\w+)?)", run("--help"))
    assert version_match, "Cannot identify native PrusaSlicer version"
    version = version_match[1]
    native, ini = work / "native.3mf", work / "native.ini"
    run("--export-3mf", "--dont-arrange", "--save", cli_path(ini),
        "--output", cli_path(native), cli_path(source))
    original = snapshot(source)
    saved = snapshot(native, ini, original[0].keys())
    assert equivalent(original, saved), f"Native round trip changed {source.name}"
    with ZipFile(source) as archive:
        manifest = json.loads(archive.read("Metadata/contour_workbench.json"))
        legend = (json.loads(archive.read("Metadata/multicolor_coupon.json"))
                  if "Metadata/multicolor_coupon.json" in archive.namelist() else None)
    results = []
    skipped = []

    def slice_signature(path):
        digest = hashlib.sha256()
        with ZipFile(path) as archive:
            # Only native model/configuration inputs drive slicing. Embedded
            # editable projects and documentation may change independently.
            for name in sorted(archive.namelist()):
                if name.startswith(("3D/", "Metadata/Slic3r_PE")):
                    digest.update(name.encode())
                    digest.update(archive.read(name))
        return digest.digest()

    for plate in manifest["plates"]:
        bed_source = work / f"plate-{plate['plate']}.3mf"
        gcode_path = bed_source.with_suffix(".gcode")
        candidate = bed_source.with_suffix(".candidate.3mf")
        one_bed(source, candidate, manifest, plate)
        cached = (reuse_slices and bed_source.exists() and gcode_path.exists()
                  and bed_source.stat().st_mtime <= gcode_path.stat().st_mtime
                  and slice_signature(bed_source) == slice_signature(candidate))
        if cached:
            with gcode_path.open() as existing:
                header = existing.read(1024)
            generated = re.search(r"PrusaSlicer[- ](\d+\.\d+\.\d+(?:[-.]\w+)?)", header)
            cached = generated is not None and generated[1] == version
        if cached:
            candidate.unlink()
        else:
            candidate.replace(bed_source)
            run("--export-gcode", "--dont-arrange", "--output", cli_path(gcode_path), cli_path(bed_source))
        gcode = gcode_path.read_text()
        assert "; generated by PrusaSlicer" in gcode
        assert "M862.3" in gcode, "Missing stock printer-model check"
        assert "M109" in gcode and "G28" in gcode, "Missing heat/homing setup"
        layer_z = list(map(float, re.findall(r"^;Z:([\d.]+)$", gcode, re.M)))
        assert layer_z, "No printable layers generated"
        resets = sum(b < a - 0.001 for a, b in zip(layer_z, layer_z[1:]))
        blocks = []
        for label in re.findall(r"^M486 S(\d+)", gcode[gcode.index(";LAYER_CHANGE"):], re.M):
            if not blocks or blocks[-1] != int(label):
                blocks.append(int(label))
        if manifest["print_sequence"] == "by object":
            # A one-layer part need not lower Z before the next part. Native
            # firmware object labels distinguish that from interleaved printing.
            assert len(blocks) == len(set(blocks)), "Object toolpaths were interleaved"
            assert blocks, "No model-object labels in toolpath"
            for missing in set(range(len(plate["objects"]))) - set(blocks):
                skipped.append({"plate": plate["plate"], "object": plate["objects"][missing]})
            assert "; complete_objects = 1" in gcode
        else:
            assert resets == 0
        if manifest["material_mode"] == "manual":
            assert not re.search(r"^T\d+", gcode, re.M), "Manual print emitted an MMU tool command"
        results.append({"plate": plate["plate"], "objects": len(plate["objects"]),
                        "layers": len(layer_z), "sequential_resets": resets,
                        "printed_object_blocks": blocks,
                        **check_filaments(bed_source, gcode, legend)})
    report = {"source": str(source), "slicer_version": version, "round_trip": "passed", "slicing": results,
              "skipped_objects": skipped}
    (work / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    assert not skipped, f"PrusaSlicer emitted no extrusion for {skipped}"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slicer", required=True, type=Path)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--reuse-slices", action="store_true", help="Reuse per-bed G-code only when the native geometry/configuration inputs are identical")
    args = parser.parse_args()
    for source in args.sources:
        verify(args.slicer.resolve(), source.resolve(), args.reuse_slices)
