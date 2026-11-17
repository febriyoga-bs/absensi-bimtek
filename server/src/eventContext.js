import { AsyncLocalStorage } from 'node:async_hooks';
import { unifiedStorage } from './unifiedStorage.js';

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
export const searchPathSql = (event = currentEvent()) => {
  const schema = eventSchema(event);
  if (!unifiedStorage()) return `SET LOCAL search_path TO "${schema}", pg_catalog`;
  const id = event?.id || 3;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Kegiatan tidak valid.');
  return `SET LOCAL ROLE bimtek_app; SET LOCAL app.event_id = '${id}'; SET LOCAL search_path TO public, pg_catalog`;
};

export const legacyReportingDays = [
  { date: '2026-11-11', label: 'Absensi Hari-1', shortDate: '11 Nov' },
  { date: '2026-11-12', label: 'Absensi Hari-2', shortDate: '12 Nov' },
];
export const eventReportingDays = () => currentEvent()?.check_in_days || legacyReportingDays;
