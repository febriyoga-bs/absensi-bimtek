const key = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z]/g, '');
// Short names chosen from the roster; distinct names avoid numeric suffixes.
const shortNames = new Map([
  ['Abdul Rangga Nopa Irhaz Putra', 'Rangga'],
  ['Rangga Rekta Prasetia', 'Rekta'],
  ['Naufal Athaya Ghani', 'Athaya'],
  ['Raden Putra Samudera', 'Putra'],
  ['Abu Ali Husa Ini', 'Ali'],
  ['Ahmad Abrori', 'Abrori'],
  ['Taufik Priyatna', 'Priyatna'],
].map(([name, nickname]) => [key(name), nickname]));

export function pksLoUsername(name) {
  const words = String(name).trim().split(/\s+/);
  const word = /^(mochamad|muhammad|muhamad)$/i.test(words[0]) ? words[1] : words[0];
  const plain = String(word || '').replace(/[^a-z]/gi, '');
  const nickname = shortNames.get(key(name)) || plain.charAt(0).toUpperCase() + plain.slice(1).toLowerCase();
  const username = `SPAB.LO.${nickname}`;
  if (!nickname || !/^SPAB\.LO\.[A-Za-z]+$/.test(username) || username.length > 32) throw new Error(`Nama panggilan perlu diperiksa: ${name}`);
  return username;
}
