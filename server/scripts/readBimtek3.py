"""Extract the assignment sheets from the Bimtek Pelaporan 3 workbook."""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook


def read_rows(book, sheet, fields, is_data):
    rows = book[sheet].values
    for _ in range(3):
        next(rows)
    headers = list(next(rows))
    indexes = {key: headers.index(label) for key, label in fields.items()}
    return [
        {key: row[index] for key, index in indexes.items()}
        for row in rows if is_data(row)
    ]


def extract(book):
    hotel_row = lambda row: row and row[0] and row[0] != "TOTAL"
    lo = read_rows(book, "Rekap LO", {
        "venue": "Hotel", "name": "Nama LO", "rooms": "Ruangan Yang Dicakup",
        "facilitator_count": "Jumlah Fasil", "school_count": "Sekolah / Bendahara",
        "coordinator_count": "Jumlah Koor", "supervisor_count": "Pengawas",
    }, lambda row: row and isinstance(row[0], (int, float)))
    facilitators = read_rows(book, "Pemetaan Fasil ke LO", {
        "venue": "Hotel", "room": "Ruangan", "group": "Kelompok", "lo": "Nama LO",
        "name": "Fasil Pelaporan", "institution": "PTN", "coordinator": "Koor Pelaporan",
        "school_count": "Jumlah Sekolah",
    }, hotel_row)
    school_rows = read_rows(book, "Sekolah per Ruangan", {
        "venue": "Hotel", "room": "Ruangan", "group": "Kelompok", "lo": "Nama LO",
        "npsn": "NPSN", "name": "Nama Sekolah", "city": "Kab/Kota", "facilitator": "Fasil Pelaporan",
        "province": "Provinsi", "institution": "PTN", "coordinator": "Koor Pelaporan", "supervisor": "ID Pengawas",
    }, hotel_row)
    schools = [
        {key: row[key] for key in ("venue", "room", "group", "lo", "npsn", "name", "city", "facilitator")}
        for row in school_rows
    ]
    venues = sorted({
        row["venue"] for row in read_rows(book, "Pembagian Ruangan", {"venue": "Hotel"}, hotel_row)
    })
    if not all((lo, facilitators, schools, venues)):
        raise ValueError("Salah satu sheet pemetaan kosong.")

    def lo_key(row, name_field):
        return row["venue"], row[name_field]

    lo_keys = {lo_key(row, "name") for row in lo}
    school_counts = Counter(lo_key(row, "lo") for row in schools)
    facilitator_counts = Counter(lo_key(row, "lo") for row in facilitators)
    if (len(lo_keys) != len(lo) or set(school_counts) != lo_keys
            or set(facilitator_counts) != lo_keys or {v for v, _ in lo_keys} != set(venues)):
        raise ValueError("Daftar LO atau hotel berbeda antarsheet.")
    for row in lo:
        key = lo_key(row, "name")
        if row["facilitator_count"] != facilitator_counts[key] or row["school_count"] != school_counts[key]:
            raise ValueError(f"Jumlah fasilitator/sekolah berbeda untuk {row['name']}.")
    for row in schools:
        row["npsn"] = str(row["npsn"]).strip()
        if len(row["npsn"]) != 8 or not row["npsn"].isdigit():
            raise ValueError(f"NPSN tidak valid: {row['npsn']}.")
    if len({row["npsn"] for row in schools}) != len(schools):
        raise ValueError("Ada NPSN ganda.")

    def fasil_key(row, name_field):
        return row["venue"], row["room"], row["group"], row["lo"], row[name_field]

    school_counts = Counter(fasil_key(row, "facilitator") for row in schools)
    expected_counts = {fasil_key(row, "name"): row["school_count"] for row in facilitators}
    if len(expected_counts) != len(facilitators) or school_counts != expected_counts:
        raise ValueError("Pemetaan sekolah berbeda dari daftar fasilitator.")
    participants = extract_participants(book, school_rows)
    return dict(venues=venues, lo=lo, facilitators=facilitators, schools=schools, participants=participants)


def extract_participants(book, schools):
    bendahara, pengawas = "1 Bendahara", "2 Pengawas"
    rows = read_rows(book, "Peserta per Ruangan", {
        "venue": "Hotel", "room": "Ruangan", "type": "Unsur", "supervisor": "ID Pengawas",
        "name": "Nama", "npsn": "NPSN",
    }, lambda row: len(row) > 3 and row[3] in (bendahara, pengawas))
    by_npsn = {str(s["npsn"]).strip(): s for s in schools}
    by_supervisor = defaultdict(list)
    for school in schools:
        if not school["supervisor"]:
            raise ValueError("Ada sekolah tanpa ID Pengawas.")
        by_supervisor[school["supervisor"]].append(school)

    def joined(group, key):
        return "; ".join(dict.fromkeys(str(s[key]).strip() for s in group if s[key])) or None

    participants = []
    seen = set()
    for row in rows:
        is_treasurer = row["type"] == bendahara
        key = str(row["npsn"]).strip() if is_treasurer else row["supervisor"]
        group = [by_npsn[key]] if is_treasurer else by_supervisor[key]
        group = sorted(group, key=lambda s: str(s["npsn"]))
        if (key in seen or not group or not str(row["name"] or "").strip()
                or any((s["venue"], s["room"]) != (row["venue"], row["room"]) for s in group)):
            raise ValueError(f"Identitas atau penempatan peserta berbeda antarsheet: {key}.")
        seen.add(key)
        npsns = [str(s["npsn"]).strip() for s in group]
        participants.append(dict(
            code=("B-" if is_treasurer else "P-") + npsns[0],
            name=row["name"].strip(), position="Bendahara" if is_treasurer else "Pengawas",
            venue=row["venue"], ruangan=row["room"], npsn="; ".join(npsns),
            institution="; ".join(s["name"] for s in group),
            provinsi=joined(group, "province"), kab_kota=joined(group, "city"),
            ptn=joined(group, "institution"), koor_pelaporan=joined(group, "coordinator"),
            fasil_pelaporan=joined(group, "facilitator"),
        ))
    if seen != set(by_npsn) | set(by_supervisor):
        raise ValueError("Daftar Bendahara atau Pengawas tidak lengkap.")
    return participants


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Pemakaian: python server/scripts/readBimtek3.py SUMBER.xlsx PEMETAAN.local")
    source, output = map(Path, sys.argv[1:])
    with source.open("rb") as stream:
        workbook = load_workbook(stream, read_only=True, data_only=True)
        try:
            roster = extract(workbook)
        finally:
            workbook.close()
    with output.open("x", encoding="utf-8") as stream:
        json.dump(roster, stream, ensure_ascii=False)
    print(" | ".join(f"{key}: {len(value)}" for key, value in roster.items()))
