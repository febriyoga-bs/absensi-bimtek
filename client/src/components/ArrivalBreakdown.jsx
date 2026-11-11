const number = new Intl.NumberFormat('id-ID');
const columns = [['invited', 'Undangan'], ['arrived', 'Tiba'], ['queued', 'Antre']];

export default function ArrivalBreakdown({ rows }) {
  if (!rows?.length) return null;

  return <table className="arrival-breakdown">
    <caption>Rincian Bendahara, Pengawas, dan Dinas</caption>
    <thead>
      <tr><th scope="col">Jenis peserta</th>
        {columns.map(([key, label]) => <th key={key} scope="col">{label}</th>)}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => <tr key={row.position}>
        <th scope="row">{row.position}</th>
        {columns.map(([key]) => <td key={key}>{number.format(row[key])}</td>)}
      </tr>)}
    </tbody>
  </table>;
}
