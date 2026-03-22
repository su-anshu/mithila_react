import Papa from 'papaparse';
import { GOOGLE_SHEETS_MASTER_URL, GOOGLE_SHEETS_NUTRITION_URL, GOOGLE_SHEETS_USA_URL } from '../constants';
import { MasterProduct, NutritionData, USProduct } from '../types';

// ─── Cache keys ──────────────────────────────────────────────────────────────
const CACHE = {
  master:      'mithila_cache_master',
  masterTs:    'mithila_cache_master_ts',
  nutrition:   'mithila_cache_nutrition',
  nutritionTs: 'mithila_cache_nutrition_ts',
  usa:         'mithila_cache_usa',
  usaTs:       'mithila_cache_usa_ts',
};

// ─── Result type ─────────────────────────────────────────────────────────────
export interface FetchResult<T> {
  data: T[];
  fromCache: boolean;
  cachedAt: Date | null;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
function saveCache(key: string, tsKey: string, data: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(tsKey, Date.now().toString());
  } catch { /* quota exceeded or unavailable */ }
}

function loadCache<T>(key: string, tsKey: string): { data: T[] | null; ts: number | null } {
  try {
    const raw = localStorage.getItem(key);
    const ts  = localStorage.getItem(tsKey);
    if (raw && ts) return { data: JSON.parse(raw) as T[], ts: parseInt(ts, 10) };
  } catch { /* corrupted JSON */ }
  return { data: null, ts: null };
}

// ─── Low-level CSV fetch ──────────────────────────────────────────────────────
function fetchCSV<T>(url: string, filterFn: (row: T) => boolean): Promise<T[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve((results.data as T[]).filter(filterFn)),
      error: (error) => reject(error),
    });
  });
}

// ─── Public fetch functions ───────────────────────────────────────────────────
export const fetchMasterData = async (): Promise<FetchResult<MasterProduct>> => {
  try {
    const data = await fetchCSV<MasterProduct>(
      GOOGLE_SHEETS_MASTER_URL,
      (row) => !!(row.Name && row.Name.trim())
    );
    saveCache(CACHE.master, CACHE.masterTs, data);
    return { data, fromCache: false, cachedAt: null };
  } catch (error) {
    const { data, ts } = loadCache<MasterProduct>(CACHE.master, CACHE.masterTs);
    if (data && data.length > 0) {
      return { data, fromCache: true, cachedAt: ts ? new Date(ts) : null };
    }
    throw error;
  }
};

export const fetchNutritionData = async (): Promise<FetchResult<NutritionData>> => {
  try {
    const data = await fetchCSV<NutritionData>(
      GOOGLE_SHEETS_NUTRITION_URL,
      (row) => !!(row.Product && row.Product.trim())
    );
    saveCache(CACHE.nutrition, CACHE.nutritionTs, data);
    return { data, fromCache: false, cachedAt: null };
  } catch (error) {
    const { data, ts } = loadCache<NutritionData>(CACHE.nutrition, CACHE.nutritionTs);
    if (data && data.length > 0) {
      return { data, fromCache: true, cachedAt: ts ? new Date(ts) : null };
    }
    throw error;
  }
};

export const fetchUSMasterData = async (): Promise<FetchResult<USProduct>> => {
  if (GOOGLE_SHEETS_USA_URL.includes('{USA_SHEET_GID}')) {
    return Promise.reject(new Error('USA sheet GID not configured. Please update GOOGLE_SHEETS_USA_URL in constants.ts with the actual GID.'));
  }
  try {
    const data = await fetchCSV<USProduct>(
      GOOGLE_SHEETS_USA_URL,
      (row) => !!(row.Name && row.Name.trim())
    );
    saveCache(CACHE.usa, CACHE.usaTs, data);
    return { data, fromCache: false, cachedAt: null };
  } catch (error) {
    const { data, ts } = loadCache<USProduct>(CACHE.usa, CACHE.usaTs);
    if (data && data.length > 0) {
      return { data, fromCache: true, cachedAt: ts ? new Date(ts) : null };
    }
    throw error;
  }
};