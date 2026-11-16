"""Extract the Bimtek Pelaporan 4 assignment workbook into an import-ready roster.

The source workbook has the same mapped sheets as Tahap 3, but its capacity and
venue data are different. This script intentionally only prepares data; it never
connects to the application database.
"""

import json
import sys
from collections import Counter
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

from readBimtek3 import extract


def rows_after_header(workbook, sheet_name):
    rows = list(workbook[sheet_name].values)
    header_index = next(index for index, row in enumerate(rows) if row and row[0] == "Hotel")
    return rows[header_index + 1:]


def assignment_conflicts(workbook):
    """Find participant assignments that cannot be represented as one venue/room."""
    schools = rows_after_header(workbook, "Sekolah per Ruangan")
    people = rows_after_header(workbook, "Peserta per Ruangan")
    schools_by_supervisor = defaultdict(set)
    school_by_npsn = {}
    for row in schools:
        if not row or not row[0]:
            continue
        location = {"venue": row[0], "room": row[1]}
        if row[12]:
            schools_by_supervisor[str(row[12]).strip()].add((row[0], row[1]))
        if row[4]:
            school_by_npsn[str(row[4]).strip()] = (row[0], row[1])

    conflicts = []
    for row in people:
        if not row or row[3] not in ("1 Bendahara", "2 Pengawas"):
            continue
        source_location = {"venue": row[0], "room": row[1]}
        if row[3] == "2 Pengawas":
            identifier = str(row[4]).strip()
            expected = schools_by_supervisor[identifier]
            if len(expected) == 1 and tuple(source_location.values()) in expected:
                continue
            conflicts.append({
                "type": "Pengawas",
                "id": identifier,
                "name": row[5],
                "source_assignment": source_location,
                "school_assignments": [
                    {"venue": venue, "room": room} for venue, room in sorted(expected)
                ],
            })
        else:
            identifier = str(row[10]).strip()
            expected = school_by_npsn.get(identifier)
            if expected == tuple(source_location.values()):
                continue
            conflicts.append({
                "type": "Bendahara",
                "id": identifier,
                "name": row[5],
                "source_assignment": source_location,
                "school_assignments": ([] if expected is None else [
                    {"venue": expected[0], "room": expected[1]}
                ]),
            })
    return conflicts


def main(source, output):
    with source.open("rb") as stream:
        workbook = load_workbook(stream, read_only=True, data_only=True)
        try:
            conflicts = assignment_conflicts(workbook)
            if conflicts:
                report = {
                    "stage": 4,
                    "source": source.name,
                    "status": "ready_with_participant_assignment_policy",
                    "summary": {
                        "assignment_conflicts": len(conflicts),
                        "message": "Penempatan pengawas mengikuti sheet Peserta per Ruangan sesuai keputusan panitia. Perbedaan tetap dicatat untuk audit.",
                    },
                    "conflicts": conflicts,
                }
                report_path = output.with_suffix(".readiness.json")
                with report_path.open("w", encoding="utf-8") as stream_out:
                    json.dump(report, stream_out, ensure_ascii=False, indent=2)
            roster = extract(workbook, participant_assignment_wins=True)
        finally:
            workbook.close()

    roster["stage"] = 4
    roster["source"] = source.name
    roster["prepared_on"] = "2026-11-16"
    roster["assignment_policy"] = "participant_sheet_wins"

    # Rooms marked this way are valid assignment data, but the organizer must
    # confirm their physical venue before activating Tahap 4 attendance.
    pending_rooms = sorted({
        (row["venue"], row["room"])
        for rows in (roster["schools"], roster["facilitators"], roster["participants"])
        for row in rows
        if "RUANGAN LAIN" in str(row.get("room") or "").upper()
    })
    roster["validation"] = {
        "counts": {key: len(roster[key]) for key in (
            "venues", "lo", "facilitators", "schools", "participants",
            "coordinators", "supervisors", "organizations"
        )},
        "pending_rooms": [
            {"venue": venue, "room": room} for venue, room in pending_rooms
        ],
        "school_distribution": dict(sorted(Counter(row["venue"] for row in roster["schools"]).items())),
        "assignment_conflicts": len(conflicts),
    }
    with output.open("x", encoding="utf-8") as stream:
        json.dump(roster, stream, ensure_ascii=False)

    print(" | ".join(f"{key}: {value}" for key, value in roster["validation"]["counts"].items()))
    print(f"Ruangan belum dikonfirmasi: {len(pending_rooms)}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Pemakaian: python server/scripts/readBimtek4.py SUMBER.xlsx PEMETAAN.local")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
