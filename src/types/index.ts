export type ImportSummary = {
  fileName: string;
  fileSize: number;
  rows: number;
  columns: number;
  hasHeader: boolean;
  sheetName?: string | null;
};

export type SearchRequest = {
  keyword: string;
  page: number;
  pageSize: number;
  columns?: string[];
};

export type SearchResponse = {
  total: number;
  page: number;
  pageSize: number;
  rows: RowData[];
};

export type RowData = Record<string, string>;
