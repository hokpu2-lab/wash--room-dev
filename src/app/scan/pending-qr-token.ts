const keys = {
  cart: "wr_pending_cart_token",
  equipment: "wr_pending_equipment_token",
} as const;

function read(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function readPendingQrToken(kind: keyof typeof keys) {
  const key = keys[kind];
  return read(window.sessionStorage, key) ?? read(window.localStorage, key);
}

export function writePendingQrToken(kind: keyof typeof keys, token: string) {
  const key = keys[kind];
  write(window.sessionStorage, key, token);
  write(window.localStorage, key, token);
}

export function clearPendingQrToken(kind: keyof typeof keys) {
  const key = keys[kind];
  try {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

