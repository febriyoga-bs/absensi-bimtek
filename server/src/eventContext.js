import { AsyncLocalStorage } from 'node:async_hooks';

export const eventContext = new AsyncLocalStorage();
export const currentEvent = () => eventContext.getStore();
export const eventId = () => currentEvent()?.id || 3;
export function eventSchema(event = currentEvent()) {
  const schema = event?.schema_name || 'public';
  if (schema !== 'public' && !/^bimtek_[1-9]\d*$/.test(schema)) throw new Error('Skema kegiatan tidak valid.');
  return schema;
}

// A transaction-local search_path also works with Supabase transaction pooling.
// Never fall back to public: a missing table must fail, not read another event.
export const searchPathSql = (event) => `SET LOCAL search_path TO "${eventSchema(event)}", pg_catalog`;

export const legacyReportingDays = [
  { date: '2026-11-11', label: 'Absensi Hari-1', shortDate: '11 Nov' },
  { date: '2026-11-12', label: 'Absensi Hari-2', shortDate: '12 Nov' },
];
export const eventReportingDays = () => currentEvent()?.check_in_days || legacyReportingDays;
