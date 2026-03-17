export interface MasterProduct {
  Name: string;
  "Net Weight": string;
  "M.R.P"?: string;
  MRP?: string;
  "M.F.G. FSSAI"?: string;
  FSSAI?: string;
  Expiry?: string;
  "Expiry "?: string;
  EXPIRY?: string;
  "Shelf Life"?: string;
  Shelf_Life?: string;
  ShelfLife?: string;
  "Expiry Months"?: string;
  FNSKU?: string;
  ASIN?: string;
  "Split Into"?: string;
  "Packet Size"?: string;
  "Packet used"?: string;
  "Product Label"?: string;
  [key: string]: string | undefined;
}

export interface USProduct extends MasterProduct {
  "M.F.G. DATE"?: string;
  "Use By Date"?: string;
  "FDA Reg. No."?: string;
  "Batch Code"?: string;
  "Merchant SKU"?: string;
  "FNSKU"?: string;
  "ASIN"?: string;
  "Packet Size"?: string;
  "Split Into"?: string;
  "Expiry"?: string;
  "FK SKU"?: string;
  "Packet used"?: string;
  "Product label"?: string;
  "Blinkit UPC Code"?: string;
  "Brand Name"?: string;
}

export interface NutritionData {
  Product: string;
  "Serving Size"?: string;
  Energy?: string | number;
  "Total Fat"?: string | number;
  "Saturated Fat"?: string | number;
  "Trans Fat"?: string | number;
  Cholesterol?: string | number;
  "Sodium(mg)"?: string | number;
  "Total Carbohydrate"?: string | number;
  "Dietary Fiber"?: string | number;
  "Total Sugars"?: string | number;
  "Added Sugars"?: string | number;
  Protein?: string | number;
  Ingredients?: string;
  "Allergen Info"?: string;
  [key: string]: string | number | undefined;
}

export interface LabelGenerationResult {
  url: string;
  filename: string;
}

export type ExpiryType = 'rel' | 'date' | null;

export interface ParsedExpiry {
  type: ExpiryType;
  value: any; // Date or object { months: number } etc
}

// Amazon Packing Plan Types
export interface OrderItem {
  ASIN: string;
  Qty: number;
  [key: string]: any;
}

export interface PhysicalItem {
  item: string;
  item_name_for_labels: string;
  weight: string;
  Qty: number;
  "Packet Size": string;
  "Packet used": string;
  ASIN: string;
  MRP: string;
  FNSKU: string;
  FSSAI: string;
  "Packed Today": string;
  Available: string;
  Status: string;
  is_split: boolean;
}

export interface MissingProduct {
  ASIN: string;
  Issue: string;
  Product?: string;
  Qty?: number;
  "Split Info"?: string;
  SKU_ID?: string;
  Weight?: string;
}

export interface ProcessingStats {
  total_invoices: number;
  multi_qty_invoices: number;
  single_item_invoices: number;
  total_qty_ordered: number;
  total_qty_physical: number;
}

// PDF Extraction Diagnostics Types
export interface QuantityDefault {
  asin: string;
  lineIndex: number;
  lineContent: string;
  searchWindowLines: string[];
  patternsAttempted: string[];
  fileName: string;
  pageNumber: number;
}

export interface RejectedAsin {
  asin: string;
  reason: string;
  lineIndex: number;
  lineContent: string;
  contextLines: string[];
  score: number;
  isInAddress: boolean;
  fileName: string;
  pageNumber: number;
}

export interface PageClassification {
  fileName: string;
  pageNumber: number;
  pageType: 'invoice' | 'shipping' | 'unknown';
  isContinuation: boolean;
  hasDescription: boolean;
  hasTOTAL: boolean;
  asinsFound: number;
  asinsAccepted: number;
  asinsRejected: number;
  pageNumbering?: string; // "Page X of Y" if found
}

export interface PDFDiagnostics {
  quantityDefaults: QuantityDefault[];
  rejectedAsins: RejectedAsin[];
  pageClassifications: PageClassification[];
  summary: {
    totalAsinsAttempted: number;
    totalAsinsAccepted: number;
    totalAsinsRejected: number;
    totalQtyDefaults: number;
    expectedQty?: number;
    extractedQty: number;
    discrepancy: number;
  };
}