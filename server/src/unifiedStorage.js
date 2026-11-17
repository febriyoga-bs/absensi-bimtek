// Legacy data is retained as a rollback source. New event-scoped tables live in public.
export const eventTables = ['settings','venues','people','sessions','attendance','attempt_logs','lo_accounts',
  'assignment_roster','school_reporting','school_progress_report','venue_arrival_recap'];
let mode = false;
export const unifiedStorage = () => mode;
export const setUnifiedStorage = (value) => { mode = value; };

// Only internal, parameterized SQL passes through this adapter. Quoted values and
// comments are consumed first, so data and JSON keys are never rewritten.
const names = eventTables.join('|');
const references = new RegExp(`'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\\n]*|/\\*[\\s\\S]*?\\*/|\\b(FROM|JOIN|UPDATE|INTO)\\s+(?:public\\.)?(${names})\\b|\\bON\\s+CONFLICT\\s*\\((?!\\s*event_id\\b)`, 'gi');
export function eventSql(sql) {
  if (!mode || typeof sql !== 'string') return sql;
  return sql.replace(references, (match, keyword, table) => keyword ? `${keyword} public.event_${table.toLowerCase()}`
    : /^ON\s+CONFLICT/i.test(match) ? 'ON CONFLICT (event_id, ' : match);
}
