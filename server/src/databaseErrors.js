// A client-side timeout can leave a query running on the connection. Destroy
// that connection instead of queueing ROLLBACK behind it or returning it to pg.
export function discardDatabaseConnection(error) {
  return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(error?.code)
    || /^08/.test(error?.code || '')
    || /Query read timeout|Connection terminated|Client has encountered a connection error/i.test(error?.message || '');
}

export function databaseUnavailable(error) {
  return discardDatabaseConnection(error)
    || ['53300', '57P01', '57P02', '57P03', '57014'].includes(error?.code)
    || /timeout exceeded when trying to connect|ECHECKOUTTIMEOUT|authentication did not complete within/i.test(error?.message || '');
}
