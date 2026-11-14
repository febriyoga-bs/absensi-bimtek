# Batas provinsi Indonesia

`indonesia-provinces.geojson` contains the 38 province boundaries used by the
public [Peta Revitalisasi](https://revit.kemendikdasmen.go.id/verval/dashboard/).
Only geographic boundary data was extracted; no source application code is included.

Source attribution published with the map:

- geoBoundaries IDN ADM2: BPS / WFP / OCHA ROAP,
  [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/).
- Indonesia 38 Provinsi: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- The source geometries were simplified and projected by DitSMP.
- This project converted the published paths back to WGS84 coordinates and
  GeoJSON MultiPolygon features, preserving geographic codes and boundary rings.

Conversion: `scripts/build-verval-boundaries.py`, given the public source
`PetaRevitalisasiPage-BWKcMhxu.js` saved as `verval-page.tmp.js` in the repository root.
