// ID perangkat untuk mendeteksi satu HP dipakai absen beberapa orang (titip absen).
const KEY = 'bimtek_device_id';

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
