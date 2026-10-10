"""Verify Bambu-sliced output from performance-tests/painted-export.spec.ts.

Usage: python3 scripts/verify-bambu-painted.py DIRECTORY
DIRECTORY contains sliced-0.3mf, sliced-0.35.3mf, and sliced--0.3.3mf.
Checks real G-code extrusion locations, not just the input painting metadata.
"""
import collections
import json
import math
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def verify(path, offset):
    with zipfile.ZipFile(path) as archive:
        info = ET.fromstring(archive.read('Metadata/slice_info.config'))
        filaments = info.findall('.//filament')
        assert {f.get('id') for f in filaments if float(f.get('used_g')) > 0} == {'1', '2', '3'}
        assert len(info.findall('.//object')) == 1
        objects = [name for name in archive.namelist() if re.match(r'3D/Objects/.*\.model$', name)]
        assert len(objects) == 1
        model = ET.fromstring(archive.read(objects[0]))
        triangles = [e for e in model.iter() if e.tag.endswith('}triangle')]
        assert {e.get('paint_color') for e in triangles} == {'4', '8', '0C'}
        bbox = json.loads(archive.read('Metadata/plate_1.json'))['bbox_all']
        assert abs(bbox[2] - bbox[0] - 60) < 0.01
        assert abs(bbox[3] - bbox[1] - 60) < 0.01
        gcode = archive.read('Metadata/plate_1.gcode').decode()
        archive.extract('Metadata/top_1.png', path.parent / path.stem)

    # Machine nozzle offsets shift G-code away from the model's plate coordinates.
    offset_match = re.search(r'^; extruder_offset = ([^\n]+)', gcode, re.M)
    nozzle_offsets = [tuple(map(float, value.split('x'))) for value in offset_match[1].split(',')]
    x = y = 0.0
    z = 0.0
    tool = 0
    feature = ''
    relative_e = False
    e_position = 0.0
    samples = collections.defaultdict(list)
    segments = []
    for line in gcode.splitlines():
        if line.startswith('; Z_HEIGHT:'):
            z = float(line.split(':')[1])
        if line.startswith('; FEATURE:'):
            feature = line.split(':', 1)[1].strip()
        if re.fullmatch(r'T\d+', line):
            tool = int(line[1:])
        if line.startswith('M83'):
            relative_e = True
        if line.startswith('M82'):
            relative_e = False
        params = {k: float(v) for k, v in re.findall(r'([XYE])(-?(?:\d+(?:\.\d*)?|\.\d+))', line.split(';')[0])}
        if line.startswith('G92') and 'E' in params:
            e_position = params['E']
        if not re.match(r'^G[01] ', line):
            continue
        nx, ny = params.get('X', x), params.get('Y', y)
        extrusion = params.get('E', 0 if relative_e else e_position)
        amount = extrusion if relative_e else extrusion - e_position
        if 'E' in params:
            e_position = extrusion if not relative_e else e_position + extrusion
        if amount > 0 and tool in (0, 1, 2) and feature == 'Top surface' and z > 2.4:
            dx, dy = nozzle_offsets[min(tool, len(nozzle_offsets) - 1)]
            a, b = (x - bbox[0] + dx, y - bbox[1] + dy), (nx - bbox[0] + dx, ny - bbox[1] + dy)
            length = math.dist(a, b)
            if length > 0 and all(-0.1 <= p <= 60.1 for point in (a, b) for p in point):
                segments.append((tool, z, a, b))
                for i in range(max(1, math.ceil(length / 0.25))):
                    t = (i + 0.5) / max(1, math.ceil(length / 0.25))
                    samples[tool].append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z))
        x, y = nx, ny

    assert all(len(samples[tool]) > 100 for tool in (0, 1, 2)), {k: len(v) for k, v in samples.items()}
    for tool, expected in [(1, (4.5, 55.5, 16.5, 19.5)), (2, (12, 24, 36, 48))]:
        measured = (min(p[0] for p in samples[tool]), max(p[0] for p in samples[tool]),
                    min(p[1] for p in samples[tool]), max(p[1] for p in samples[tool]))
        # Top infill stops inside the surrounding perimeters, within two nozzle widths.
        assert all(abs(actual - target) < 0.8 for actual, target in zip(measured, expected)), measured
    # Nozzle-width tolerance accommodates wall overlap and perimeter placement.
    for x, y, _ in samples[1]:
        assert 4.0 <= x <= 56.0 and 16.0 <= y <= 20.0, ('trail', x, y)
    for x, y, _ in samples[2]:
        assert 11.5 <= x <= 24.5 and 35.5 <= y <= 48.5, ('lake', x, y)
    for x, y, z in samples[0]:
        # Terrain extrusions underneath raised features are hidden by their later caps.
        if z < 3 + offset - 0.15:
            continue
        assert not (7 < x < 53 and 17.2 < y < 18.8), ('terrain inside trail', path.name, x, y, z)
        assert not (12.7 < x < 23.3 and 36.7 < y < 47.3), ('terrain inside lake', x, y)
    for tool in (1, 2):
        assert abs(max(p[2] for p in samples[tool]) - (3 + offset)) < 0.2
    result = {
        'file': path.name, 'objects': 1, 'filaments': 3,
        'top_surface_samples': {str(k + 1): len(v) for k, v in samples.items()},
        'top_surface_height_mm': {str(k + 1): max(p[2] for p in v) for k, v in samples.items()},
        'filament_usage_g': {f.get('id'): float(f.get('used_g')) for f in filaments},
        'checks': 'passed',
    }
    # Keep the measured paths for plotting independently of slicer thumbnails.
    (path.parent / f'{path.stem}-toolpaths.json').write_text(json.dumps(segments))
    return result


directory = pathlib.Path(sys.argv[1])
results = [verify(directory / f'sliced-{offset}.3mf', float(offset)) for offset in ['0', '0.35', '-0.3']]
(directory / 'slicer-verification.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
