import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { Skel, SkelRows, SkelLines, Spinner } from '../../components/Skeleton.jsx';
import { formatRoom } from '../../lib/room.js';

// urutan alami: LO2-01 sebelum LO10-01, tanpa peduli huruf besar/kecil
const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'id', { numeric: true, sensitivity: 'base' });
const SORTS = { code: 'Kode', name: 'Nama', institution: 'Instansi', position: 'Jabatan', kab_kota: 'Kab/Kota', ruangan: 'Ruangan', venue_name: 'Venue' };

// kolom tambahan sesuai file Pemetaan Sekolah
const EXTRA = [
  ['npsn', 'NPSN'], ['region', 'Region'], ['ruangan', 'Ruangan'], ['peringkat', 'Peringkat'],
  ['provinsi', 'Provinsi'], ['kab_kota', 'Kab/Kota'], ['ptn', 'PTN'],
  ['koor_pelaporan', 'Koor Pelaporan'], ['fasil_pelaporan', 'Fasil Pelaporan'], ['notes', 'Catatan'],
];
const blank = {
  id: null, code: '', name: '', role: 'peserta', institution: '', position: '', phone: '', venue_id: '',
  ...Object.fromEntries(EXTRA.map(([k]) => [k, ''])),
};
const PAGE = 200;

export default function People() {
  const [role, setRole] = useState('peserta');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState([]);
  const [form, setForm] = useState(blank);
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState(null);
  const [fVenue, setFVenue] = useState('');       // '' semua | 'none' tanpa venue | id
  const [fPos, setFPos] = useState('');
  const [fRegion, setFRegion] = useState('');
  const [fRoom, setFRoom] = useState('');
  const [fProv, setFProv] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState({ key: 'code', dir: 1 });
  const requestId = useRef(0);

  useEffect(() => { api('/admin/venues', { admin: true }).then(setVenues); }, []);
  async function load() {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const rows = await api(`/admin/people?role=${role}&q=${encodeURIComponent(search)}&archived=${archived}`, { admin: true });
      if (requestId.current === id) setList(rows);
    } catch (e) {
      if (requestId.current === id) setMsg({ err: true, text: e.message });
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => { clearTimeout(t); requestId.current++; };
  }, [role, search, archived]);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    try {
      await api(form.id ? `/admin/people/${form.id}` : '/admin/people', { method: form.id ? 'PUT' : 'POST', admin: true, body: form });
      setForm({ ...blank, role });
      setMsg(null);
      load();
    } catch (e) { setMsg({ err: true, text: e.message }); }
  }

  async function importCsv() {
    setBusy(true);
    try {
      const r = await api('/admin/people/import', { method: 'POST', admin: true, body: { csv, role } });
      const notes = [...r.errors, ...(r.warnings || [])];
      const parts = Object.entries(r.summary || {}).map(([k, n]) => `${n} ${k}`).join(', ');
      setMsg({ err: r.errors.length > 0, warn: !r.errors.length && notes.length > 0,
        text: `${r.format === 'pemetaan' ? 'File Pemetaan Sekolah dikenali. ' : ''}${r.imported} data diimpor${parts ? ` (${parts})` : ''}; kode yang sudah ada diperbarui.${notes.length ? ' ' + notes.join(' | ') : ''}` });
      if (!r.errors.length) setCsv('');
      load();
    } catch (e) { setMsg({ err: true, text: e.message }); }
    finally { setBusy(false); }
  }

  async function del(p) {
    if (!window.confirm(`Hapus ${p.name}?`)) return;
    await api(`/admin/people/${p.id}`, { method: 'DELETE', admin: true });
    load();
  }

  const switchRole = (r) => {
    if (r !== role) {
      setList([]); setLoading(true); setArchived(false); setRole(r);
    }
    setForm({ ...blank, role: r });
    resetFilters();
  };
  const resetFilters = () => { setFVenue(''); setFPos(''); setFRegion(''); setFRoom(''); setFProv(''); };

  // pilihan filter diambil dari data yang ada
  const uniq = (k) => [...new Set(list.map((p) => p[k]).filter(Boolean))].sort(cmp);
  const posOpts = useMemo(() => uniq('position'), [list]);
  const regionOpts = useMemo(() => uniq('region'), [list]);
  const roomOpts = useMemo(() => uniq('ruangan'), [list]);
  const provOpts = useMemo(() => uniq('provinsi'), [list]);

  const shown = useMemo(() => {
    const out = list.filter((p) =>
      (!fVenue || (fVenue === 'none' ? !p.venue_id : String(p.venue_id) === fVenue)) &&
      (!fPos || p.position === fPos) &&
      (!fRegion || p.region === fRegion) &&
      (!fRoom || p.ruangan === fRoom) &&
      (!fProv || p.provinsi === fProv));
    return out.sort((a, b) => cmp(a[sort.key] ?? (sort.key === 'venue_name' ? '\uffff' : ''), b[sort.key] ?? (sort.key === 'venue_name' ? '\uffff' : '')) * sort.dir
      || cmp(a.code, b.code));
  }, [list, fVenue, fPos, fRegion, fRoom, fProv, sort]);
  useEffect(() => setLimit(PAGE), [list, fVenue, fPos, fRegion, fRoom, fProv, sort]);

  const filtered = fVenue || fPos || fRegion || fRoom || fProv;
  const qrLink = (p) => `${window.location.origin}/qr/${p.qr_token}`;

  // CSV berisi link QR pribadi + link WhatsApp siap kirim (mengikuti filter yang aktif)
  function exportQrLinks() {
    const missing = shown.filter((p) => !p.qr_token).length;
    if (missing === shown.length) {
      setMsg({ err: true, text: 'Token QR belum ada di database. Jalankan "npm run migrate" di folder server (database produksi), lalu muat ulang halaman ini.' });
      return;
    }
    if (missing) setMsg({ warn: true, text: `${missing} orang belum punya token QR dan tidak ikut diekspor. Jalankan "npm run migrate" lalu ekspor ulang.` });
    const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const waNum = (ph) => {
      const d = String(ph || '').replace(/\D/g, '');
      return d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d;
    };
    const head = ['Kode', 'Nama', 'Jabatan', 'Instansi / Sekolah', 'Venue', 'Ruangan', 'Telepon', 'Link QR', 'Link WhatsApp'];
    const lines = shown.filter((p) => p.qr_token).map((p) => {
      const msg = `Yth. ${p.name},\nBerikut kartu identitas pribadi Anda untuk BIMTEK Revitalisasi SD:\n${qrLink(p)}\n\n`
        + `Temui LO di venue dan tunjukkan nama atau kode peserta untuk pencatatan absensi.${p.ruangan ? ` Ruangan Anda: ${formatRoom(p.ruangan)}.` : ''}`
        + ' Mohon tidak dibagikan ke orang lain. Terima kasih.';
      const wa = waNum(p.phone);
      return [p.code, p.name, p.position, p.institution, p.venue_name || 'Semua', p.ruangan, p.phone, qrLink(p),
        `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` /* tanpa nomor → pilih kontak di WA */].map(esc).join(',');
    });
    const blob = new Blob(['\uFEFF' + [head.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `link-qr-${role}${filtered ? '-filter' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const Th = ({ k, children }) => (
    <th className="th-sort" onClick={() => sortBy(k)} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {children}<span className="th-sort__arrow">{sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</span>
    </th>
  );

  return (
    <>
      <div className="page-head"><div><h2>Peserta & Panitia</h2>
        <p className="muted">Kelola identitas dan penempatan peserta. Kode membantu LO mencari peserta; pencatatan absensi mengikuti penugasan LO dan sesi aktif.</p></div>
        <Link className="btn" to="/admin/orang/sinkronisasi">Pratinjau Sinkronisasi Absensi</Link>
      </div>
      <div className="tabs">
        <button className={role === 'peserta' ? 'on' : ''} onClick={() => switchRole('peserta')}>Peserta</button>
        <button className={role === 'panitia' ? 'on' : ''} onClick={() => switchRole('panitia')}>Panitia</button>
      </div>

      <div className="two-col">
        <form className="card form form--grid" onSubmit={save}>
          <h3 className="span2">{form.id ? 'Ubah data' : `Tambah ${role}`}</h3>
          <label>Kode<input value={form.code} onChange={f('code')} required /></label>
          <label>Nama lengkap<input value={form.name} onChange={f('name')} required /></label>
          <label>Instansi / Sekolah<input value={form.institution || ''} onChange={f('institution')} /></label>
          <label>Jabatan<input value={form.position || ''} onChange={f('position')} /></label>
          <label>No. HP<input value={form.phone || ''} onChange={f('phone')} /></label>
          <label>Peran<select value={form.role} onChange={f('role')}>
            <option value="peserta">Peserta</option><option value="panitia">Panitia</option>
          </select></label>
          <details className="span2 more-fields" open={EXTRA.some(([k]) => form[k])}>
            <summary>Data sekolah / pemetaan (NPSN, ruangan, wilayah, PTN…)</summary>
            <div className="form--grid">
              {EXTRA.map(([k, l]) => (
                <label key={k} className={k === 'notes' ? 'span2' : ''}>{l}<input value={form[k] || ''} onChange={f(k)} /></label>
              ))}
            </div>
          </details>
          <label className="span2">Venue<select value={form.venue_id ?? ''} onChange={f('venue_id')}>
            <option value="">Semua venue (bebas)</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          <div className="row span2">
            <button className="btn btn--primary"><Icon name={form.id ? 'check' : 'plus'} size={18} />{form.id ? 'Simpan' : 'Tambah'}</button>
            {form.id && <button type="button" className="btn" onClick={() => setForm({ ...blank, role })}>Batal</button>}
          </div>
        </form>

        <div className="card form" style={{ alignSelf: 'start' }}>
          <h3>Impor CSV / tempel dari Excel</h3>
          <p className="muted small" style={{ margin: 0 }}>Kolom: <code>kode, nama, peran, instansi, jabatan, telepon, venue</code>
            {' '}(+ opsional <code>npsn, region, ruangan, provinsi, kab/kota, ptn, peringkat, catatan</code> bila ada header).
            Peran kosong = "{role}". Venue diisi <b>nama venue</b> atau kosong (bebas). Pemisah koma / titik-koma.</p>
          <p className="muted small" style={{ margin: 0 }}>File <b>Pemetaan Sekolah</b> bisa langsung dipilih: Bendahara → kode <code>B-NPSN</code>,
            Pengawas (digabung per orang) → kode <code>P-NPSN</code>. Perencana tidak diimpor.</p>
          <label className="btn file-pick">
            <Icon name="list" size={18} />Pilih file CSV…
            <input type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              file.text().then((t) => {
                setCsv(t.replace(/^﻿/, ''));
                setMsg({ text: `File "${file.name}" dimuat (${t.trim().split(/\r?\n/).length - 1} baris data). Periksa lalu klik Impor.` });
              });
              e.target.value = '';
            }} />
          </label>
          <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)}
            placeholder={`…atau tempel isi CSV / salin dari Excel di sini\n\nkode,nama,peran,instansi,jabatan,telepon,venue\nP-001,Siti Aminah,peserta,SDN 1 Contoh,Kepala Sekolah,0812...,${venues[0]?.name || 'Hotel A'}`} />
          <button className="btn btn--primary" onClick={importCsv} disabled={busy || !csv.trim()}><Icon name="download" size={18} />{busy ? <><Spinner /> Mengimpor…</> : 'Impor'}</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.err ? 'alert--err' : msg.warn ? 'alert--warn' : 'alert--ok'}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      <div className="toolbar filters">
        <input placeholder="Cari nama / kode / sekolah / NPSN / kab/kota" value={search} onChange={(e) => setSearch(e.target.value)} />
        {role === 'peserta' && <select aria-label="Status peserta" value={archived ? 'archived' : 'active'} onChange={(e) => {
          setArchived(e.target.value === 'archived'); setList([]); setLoading(true); resetFilters();
        }}>
          <option value="active">Peserta aktif</option>
          <option value="archived">Arsip peserta</option>
        </select>}
        <select value={fVenue} onChange={(e) => setFVenue(e.target.value)} aria-label="Filter venue">
          <option value="">Semua venue</option>
          <option value="none">— Tanpa venue (bebas)</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={fPos} onChange={(e) => setFPos(e.target.value)} aria-label="Filter jabatan">
          <option value="">Semua jabatan</option>
          {posOpts.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        {regionOpts.length > 0 && (
          <select value={fRegion} onChange={(e) => setFRegion(e.target.value)} aria-label="Filter region">
            <option value="">Semua region</option>
            {regionOpts.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        {roomOpts.length > 0 && (
          <select value={fRoom} onChange={(e) => setFRoom(e.target.value)} aria-label="Filter ruangan">
            <option value="">Semua ruangan</option>
            {roomOpts.map((x) => <option key={x} value={x}>{formatRoom(x)}</option>)}
          </select>
        )}
        {provOpts.length > 0 && (
          <select value={fProv} onChange={(e) => setFProv(e.target.value)} aria-label="Filter provinsi">
            <option value="">Semua provinsi</option>
            {provOpts.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir: Number(dir) }); }} aria-label="Urutkan">
          {Object.entries(SORTS).flatMap(([k, l]) => [
            <option key={k + '1'} value={`${k}:1`}>Urut: {l} (A–Z)</option>,
            <option key={k + '-1'} value={`${k}:-1`}>Urut: {l} (Z–A)</option>,
          ])}
        </select>
        {filtered && <button className="btn btn--sm" onClick={resetFilters}><Icon name="x" size={14} />Reset filter</button>}
        <span className="muted">{loading ? <><Spinner size={14} /> Memuat…</> : <>{filtered ? `${shown.length} dari ${list.length}` : list.length} orang</>}</span>
        {!archived && <button className="btn btn--sm" onClick={exportQrLinks} disabled={!shown.length} title="CSV berisi link QR pribadi & link WhatsApp untuk orang yang tampil">
          <Icon name="share" size={14} />Ekspor link QR (WA)</button>}
      </div>
      <table className="table stack-table" role="table" aria-label="Daftar peserta dan panitia">
        <thead><tr>
          <Th k="code">Kode</Th><Th k="name">Nama</Th><Th k="position">Jabatan</Th><Th k="institution">Instansi / Sekolah</Th>
          <Th k="kab_kota">Wilayah</Th><Th k="ruangan">Ruangan</Th><Th k="venue_name">Venue</Th><th></th>
        </tr></thead>
        <tbody style={loading && list.length ? { opacity: 0.55, transition: 'opacity .2s' } : undefined}>
          {shown.slice(0, limit).map((p) => (
            <tr key={p.id} role="row">
              <td role="cell" className="nowrap"><code>{p.code}</code></td>
              <td role="cell" data-label="Nama" className="stack-full"><b>{p.name}</b>{p.phone && <div className="muted small">{p.phone}</div>}
                {p.notes && <div className="note-flag small" title={p.notes}><Icon name="alert" size={12} /> {p.notes}</div>}</td>
              <td role="cell" data-label="Jabatan">{p.position}</td>
              <td role="cell" data-label="Instansi / Sekolah" className="cell-clamp" title={p.institution || ''}>{p.institution}
                {p.npsn && <div className="muted small">NPSN {p.npsn}</div>}</td>
              <td role="cell" data-label="Wilayah" className="small cell-clamp" title={[p.kab_kota, p.provinsi].filter(Boolean).join(', ')}>
                {p.kab_kota}{p.provinsi && <div className="muted">{p.provinsi}</div>}</td>
              <td role="cell" data-label="Ruangan" className="small">{formatRoom(p.ruangan)}{p.region && <div className="muted">{p.region}</div>}</td>
              <td role="cell" data-label="Venue">{p.venue_name ? <span className="tag tag--venue">{p.venue_name}</span> : <span className="muted small">Semua</span>}</td>
              <td role="cell" className="stack-full">{p.archived_at ? <span className="tag tag--off">Diarsipkan</span> : <div className="row">
                {p.qr_token && <a className="btn btn--sm" href={qrLink(p)} target="_blank" rel="noreferrer" title="Buka kartu QR"><Icon name="qr" size={14} />QR</a>}
                <button className="btn btn--sm" onClick={() => { setForm({ ...p, venue_id: p.venue_id ?? '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Ubah</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(p)}>Hapus</button>
              </div>}</td>
            </tr>
          ))}
          {loading && !list.length && <SkelRows rows={8} cols={8} />}
          {!loading && !shown.length && <tr><td colSpan={8} className="muted">{list.length ? 'Tidak ada yang cocok dengan filter.' : 'Belum ada data.'}</td></tr>}
        </tbody>
      </table>
      {shown.length > limit && (
        <div className="pager">
          <span className="muted small">Menampilkan {limit} dari {shown.length}</span>
          <button className="btn btn--sm" onClick={() => setLimit(limit + PAGE * 2)}>Tampilkan lebih banyak</button>
          <button className="btn btn--sm" onClick={() => setLimit(shown.length)}>Tampilkan semua</button>
        </div>
      )}
    </>
  );
}
