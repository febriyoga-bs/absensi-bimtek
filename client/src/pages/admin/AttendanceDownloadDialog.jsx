import { useEffect, useRef, useState } from 'react';
import { api, adminUrl } from '../../api.js';
import FilterField from '../../components/FilterField.jsx';
import Icon from '../../components/Icon.jsx';
import { printAttendance } from '../../lib/printAttendance.js';
import { sessionTitle } from './shared.js';
import { downloadAttendanceExcel } from '../../lib/attendanceExcel.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { personName } from '../../lib/personName.js';

const statusLabels = { valid: 'Valid', review: 'Perlu dicek', ditolak: 'Ditolak', berhalangan: 'Mundur/Berhalangan Hadir' };

export default function AttendanceDownloadDialog({ sessions, venues, lo, initial, onClose }) {
  const dialog = useRef(null);
  const [filters, setFilters] = useState(initial);
  const [format, setFormat] = useState('xlsx');
  const [scope, setScope] = useState('recorded');
  const [recorders, setRecorders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  useEffect(() => {
    if (!filters.session_id) return;
    let active = true;
    const params = new URLSearchParams({ session_id: filters.session_id, limit: '1', ...(filters.venue_id && { venue_id: filters.venue_id }) });
    setRecorders([]);
    api(`/admin/attendance?${params}`, { admin: true }).then((data) => { if (active) setRecorders(data.recorders || []); }).catch(() => {});
    return () => { active = false; };
  }, [filters.session_id, filters.venue_id]);
  const change = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value,
    ...(['session_id', 'venue_id'].includes(key) ? { recorded_by: '' } : {}) }));

  async function download(event) {
    event.preventDefault();
    if (busy || !filters.session_id) return;
    setBusy(true); setError(''); setProgress('');
    const selected = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
    if (lo) delete selected.venue_id;
    try {
      if (format === 'pdf') {
        const sessionName = sessionTitle(sessions.find((session) => String(session.id) === String(filters.session_id)));
        const venueName = selected.venue_id ? venues.find((venue) => String(venue.id) === String(selected.venue_id))?.name : lo && venues.length === 1 ? venues[0].name : 'Semua venue';
        const title = [sessionName, venueName,
          selected.recorded_by || 'Semua LO pencatat', selected.position || 'Semua jabatan', statusLabels[selected.status] || 'Semua status'].filter(Boolean).join(' · ');
        await printAttendance({ filters: selected, title, heading: `Rekap Absensi - ${sessionName} - ${venueName}`, onProgress: setProgress });
      } else {
        const query = new URLSearchParams({ ...selected, ...(scope === 'all' ? { include_all: 'true' } : { recorded_only: 'true' }) });
        const response = await fetch(adminUrl(`/export?${query}`));
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Unduhan gagal. Silakan coba lagi.');
        }
        if (format === 'xlsx') {
          setProgress('merapikan kolom');
          await downloadAttendanceExcel(await response.text(), `rekap-absensi-${filters.session_id}.xlsx`);
        } else downloadFile(await response.blob(), `rekap-absensi-${filters.session_id}.csv`);
      }
      onClose();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="assignment-dialog attendance-download-dialog" aria-labelledby="attendance-download-title"
    onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <header><div><h3 id="attendance-download-title">Unduh rekap absensi</h3><p className="muted small">Pilih filter dan tipe berkas yang ingin diunduh.</p></div>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={onClose} aria-label="Tutup unduhan">Tutup</button>
    </header>
    <form onSubmit={download}>
      <fieldset disabled={busy} className="download-filter-grid">
        <FilterField label="Tipe unduhan"><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF</option><option value="csv">CSV</option></select></FilterField>
        <FilterField label="Sesi absensi"><select required value={filters.session_id} onChange={change('session_id')}>
          {sessions.map((session) => <option key={session.id} value={session.id}>{sessionTitle(session)} ({session.role})</option>)}
        </select></FilterField>
        {!lo && <FilterField label="Venue"><select value={filters.venue_id} onChange={change('venue_id')}><option value="">Semua venue</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></FilterField>}
        <FilterField label="LO pencatat"><select value={filters.recorded_by} onChange={change('recorded_by')}><option value="">Semua LO pencatat</option>
          {filters.recorded_by && !recorders.includes(filters.recorded_by) && <option value={filters.recorded_by}>{personName(filters.recorded_by)}</option>}
          {recorders.map((name) => <option key={name} value={name}>{personName(name)}</option>)}
        </select></FilterField>
        <FilterField label="Jabatan"><select value={filters.position} onChange={change('position')}><option value="">Semua jabatan</option><option value="lo">LO</option><option value="bendahara">Bendahara</option><option value="pengawas">Pengawas</option><option value="fasil">Fasilitator</option></select></FilterField>
        <FilterField label="Status absensi"><select value={filters.status} onChange={change('status')}><option value="">Semua status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FilterField>
        {format !== 'pdf' && <FilterField label="Cakupan peserta"><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="recorded">Catatan absensi</option><option value="all">Semua peserta, termasuk belum absen</option></select></FilterField>}
      </fieldset>
      {format === 'pdf' && <p className="muted small">PDF menyertakan foto absensi dalam empat kolom dan langsung diunduh.</p>}
      {format === 'xlsx' && <p className="muted small">Excel dengan header biru, lebar kolom menyesuaikan isi, dan catatan panjang dibungkus otomatis.</p>}
      {error && <p className="alert alert--err" role="alert">{error}</p>}
      {busy && <p className="muted small" role="status">Menyiapkan {format.toUpperCase()} {progress}…</p>}
      <footer className="download-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className="btn btn--primary" disabled={busy || !filters.session_id}><Icon name="download" size={16} />{busy ? 'Menyiapkan…' : `Unduh ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}`}</button>
      </footer>
    </form>
  </dialog>;
}
