/**
 * Anonymous identity. Every browser gets a random UUID on first visit; it is
 * kept in a first-party cookie (plus localStorage as fallback) and doubles as
 * the key to restore data on another device when a sync server is available.
 */
const COOKIE = 'polestarlize_id';
const STORAGE_KEY = 'polestarlize.id';
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUserId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function readCookie(): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

function writeCookie(id: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(id)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persist(id: string) {
  writeCookie(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage may be disabled; the cookie still works.
  }
}

let current: string | null = null;
let firstVisit = false;

export function getUserId(): string {
  if (current) return current;
  const existing = [readCookie(), readStorage()].find((v): v is string => !!v && isValidUserId(v));
  firstVisit = !existing;
  current = (existing ?? crypto.randomUUID()).toLowerCase();
  // Refresh the cookie so it does not expire while the site is in use.
  persist(current);
  return current;
}

/** True when this browser had no identity before the current page load. */
export function isFirstVisit(): boolean {
  getUserId();
  return firstVisit;
}

export function setUserId(id: string): void {
  if (!isValidUserId(id)) throw new Error('Invalid ID');
  current = id.trim().toLowerCase();
  persist(current);
}

export function newUserId(): string {
  const id = crypto.randomUUID();
  setUserId(id);
  return id;
}
