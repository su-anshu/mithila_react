import Papa from 'papaparse';
import { GOOGLE_SHEETS_MASTER_URL, GOOGLE_SHEETS_NUTRITION_URL, GOOGLE_SHEETS_USA_URL } from '../constants';
import { MasterProduct, NutritionData, USProduct } from '../types';

export const fetchMasterData = async (): Promise<MasterProduct[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(GOOGLE_SHEETS_MASTER_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Filter out empty rows based on Name
        const data = (results.data as MasterProduct[]).filter(row => row.Name && row.Name.trim() !== '');
        resolve(data);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};

export const fetchNutritionData = async (): Promise<NutritionData[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(GOOGLE_SHEETS_NUTRITION_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = (results.data as NutritionData[]).filter(row => row.Product && row.Product.trim() !== '');
        resolve(data);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};

export const fetchUSMasterData = async (): Promise<USProduct[]> => {
  return new Promise((resolve, reject) => {
    // Check if URL has placeholder GID
    if (GOOGLE_SHEETS_USA_URL.includes('{USA_SHEET_GID}')) {
      reject(new Error('USA sheet GID not configured. Please update GOOGLE_SHEETS_USA_URL in constants.ts with the actual GID.'));
      return;
    }
    
    Papa.parse(GOOGLE_SHEETS_USA_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Filter out empty rows based on Name
        const data = (results.data as USProduct[]).filter(row => row.Name && row.Name.trim() !== '');
        resolve(data);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};