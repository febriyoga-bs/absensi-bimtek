"""Convert the source dashboard's openly licensed boundary paths to WGS84 GeoJSON.

Input: reference bundle downloaded as verval-page.tmp.js (not committed).
Boundary attribution is included in the resulting asset and map UI.
Only geographic data is extracted; no source application code is executed.
"""
import json
import math
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / 'verval-page.tmp.js').read_text(encoding='utf-8')
source = source[source.index('var ym='):]
matches = re.findall(r'(?:\{|,)(\d{2}):\{d:`([^`]+)`', source)
assert len(matches) == 38, f'Expected 38 provinces, got {len(matches)}'
scale = 100000 / math.radians(46.4)
mercator_top = math.log(math.tan(math.pi / 4 + math.radians(6.3) / 2))

def convert(x, y):
    return [round(94.8 + math.degrees(x / scale), 5),
            round(math.degrees(2 * math.atan(math.exp(mercator_top - y / scale)) - math.pi / 2), 5)]

def rings(path):
    tokens = re.findall(r'[Mlhvz]|-?\d+(?:\.\d+)?', path)
    result, ring, command = [], [], None
    x = y = 0
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command == 'z':
                assert len(ring) >= 3
                if ring[-1] != ring[0]:
                    ring.append(ring[0])
                x, y = ring[0]
                result.append(ring)
                ring = []
                continue
        if command in ('M', 'l'):
            a, b = float(tokens[index]), float(tokens[index + 1])
            index += 2
            x, y = (a, b) if command == 'M' else (x + a, y + b)
            if command == 'M':
                command = 'l'
        elif command == 'h':
            x += float(tokens[index]); index += 1
        elif command == 'v':
            y += float(tokens[index]); index += 1
        else:
            raise ValueError(f'Unsupported path command: {command}')
        ring.append((x, y))
    assert not ring
    return result

def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

def contains(ring, point):
    x, y = point
    inside = False
    for (a, b), (c, d) in zip(ring, ring[1:]):
        if (b > y) != (d > y) and x < (c - a) * (y - b) / (d - b) + a:
            inside = not inside
    return inside

features = []
for code, path in matches:
    ordered = sorted(rings(path), key=lambda ring: abs(signed_area(ring)), reverse=True)
    # SVG uses the even-odd fill rule: nested rings alternate holes and islands.
    polygons, depths = [], []
    for ring in ordered:
        parents = [i for i, other in enumerate(ordered[:len(depths)]) if contains(other, ring[0])]
        depth = max((depths[i] + 1 for i in parents), default=0)
        depths.append(depth)
        if depth % 2 == 0:
            polygons.append([ring])
        else:
            parent = next(poly for poly in reversed(polygons) if contains(poly[0], ring[0]))
            parent.append(ring)
    coordinates = []
    for polygon in polygons:
        projected = []
        for i, ring in enumerate(polygon):
            geographic = [convert(x, y) for x, y in ring]
            if (signed_area(geographic) > 0) != (i == 0):
                geographic.reverse()
            projected.append(geographic)
        coordinates.append(projected)
    features.append({'type': 'Feature', 'properties': {'code': code},
                     'geometry': {'type': 'MultiPolygon', 'coordinates': coordinates}})

output = root / 'client/public/geo/indonesia-provinces.geojson'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({
    'type': 'FeatureCollection',
    'attribution': 'geoBoundaries IDN ADM2 (BPS / WFP / OCHA ROAP), CC BY 3.0 IGO; '
                   'Indonesia 38 Provinsi, CC BY 4.0. Simplified/projected by DitSMP; '
                   'converted to WGS84 from public revit.kemendikdasmen.go.id/dashboard boundaries.',
    'features': features,
}, separators=(',', ':')), encoding='utf-8')
print(f'{len(features)} provinces; {output.stat().st_size:,} bytes')
