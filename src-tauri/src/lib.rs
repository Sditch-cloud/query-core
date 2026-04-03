use calamine::{open_workbook_auto, Data, Dimensions, Reader, Sheets};
use csv::ReaderBuilder;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::RwLock;
use tauri::State;

const MAX_FILE_SIZE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PAGE_SIZE: usize = 500;

#[derive(Default)]
struct AppState {
    dataset: RwLock<Option<DataSet>>,
}

#[derive(Clone, Debug)]
struct DataSet {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    file_name: String,
    file_size: u64,
    has_header: bool,
    sheet_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
    file_path: String,
    has_header: bool,
    sheet_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSheetsRequest {
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportSummary {
    file_name: String,
    file_size: u64,
    rows: usize,
    columns: usize,
    has_header: bool,
    sheet_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    keyword: String,
    page: usize,
    page_size: usize,
    columns: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    total: usize,
    page: usize,
    page_size: usize,
    headers: Vec<String>,
    rows: Vec<BTreeMap<String, String>>,
}

fn validate_pagination(page: usize, page_size: usize) -> Result<(), String> {
    if page == 0 {
        return Err("page 必须大于 0".to_string());
    }
    if page_size == 0 || page_size > MAX_PAGE_SIZE {
        return Err(format!("pageSize 必须在 1 到 {} 之间", MAX_PAGE_SIZE));
    }

    Ok(())
}

fn normalize_row(mut row: Vec<String>, target_len: usize) -> Vec<String> {
    if row.len() < target_len {
        row.resize(target_len, String::new());
    }
    row
}

fn generate_headers(count: usize) -> Vec<String> {
    (1..=count).map(|idx| format!("column_{}", idx)).collect()
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(v) => v.to_string(),
        Data::Float(v) => v.to_string(),
        Data::Int(v) => v.to_string(),
        Data::Bool(v) => v.to_string(),
        Data::DateTime(v) => v.to_string(),
        Data::DateTimeIso(v) => v.to_string(),
        Data::DurationIso(v) => v.to_string(),
        Data::Error(v) => v.to_string(),
    }
}

fn fill_merged_cells(rows: &mut Vec<Vec<String>>, range_start: (u32, u32), merges: &[Dimensions]) {
    for dim in merges {
        let start_row = (dim.start.0 as usize).saturating_sub(range_start.0 as usize);
        let start_col = (dim.start.1 as usize).saturating_sub(range_start.1 as usize);
        let end_row = (dim.end.0 as usize).saturating_sub(range_start.0 as usize);
        let end_col = (dim.end.1 as usize).saturating_sub(range_start.1 as usize);

        let value = rows
            .get(start_row)
            .and_then(|row| row.get(start_col))
            .cloned()
            .unwrap_or_default();

        for r in start_row..=end_row {
            if let Some(row) = rows.get_mut(r) {
                for c in start_col..=end_col {
                    if let Some(cell) = row.get_mut(c) {
                        *cell = value.clone();
                    }
                }
            }
        }
    }
}

fn parse_csv(file_path: &str, has_header: bool) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut reader = ReaderBuilder::new()
        .has_headers(has_header)
        .from_path(file_path)
        .map_err(|err| format!("CSV 打开失败: {}", err))?;

    let mut headers: Vec<String> = Vec::new();
    if has_header {
        headers = reader
            .headers()
            .map_err(|err| format!("CSV 读取表头失败: {}", err))?
            .iter()
            .map(str::to_string)
            .collect();
    }

    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut max_cols = headers.len();

    for result in reader.records() {
        let record = result.map_err(|err| format!("CSV 读取失败: {}", err))?;
        let row: Vec<String> = record.iter().map(str::to_string).collect();
        max_cols = max_cols.max(row.len());
        rows.push(row);
    }

    if !has_header {
        if max_cols == 0 {
            return Err("CSV 文件为空".to_string());
        }
        headers = generate_headers(max_cols);
    } else if headers.is_empty() && max_cols == 0 {
        return Err("CSV 文件为空".to_string());
    }

    if headers.len() < max_cols {
        let mut extra_headers = generate_headers(max_cols);
        extra_headers.drain(..headers.len());
        headers.extend(extra_headers);
    }

    let normalized_rows = rows
        .into_iter()
        .map(|row| normalize_row(row, headers.len()))
        .collect();

    Ok((headers, normalized_rows))
}

fn parse_xlsx(
    file_path: &str,
    has_header: bool,
    selected_sheet: Option<&str>,
) -> Result<(String, Vec<String>, Vec<Vec<String>>), String> {
    let mut workbook = open_workbook_auto(file_path).map_err(|err| format!("Excel 打开失败: {}", err))?;
    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("Excel 没有工作表".to_string());
    }

    let target_sheet = if let Some(sheet_name) = selected_sheet {
        if !sheet_names.iter().any(|name| name == sheet_name) {
            return Err(format!("未找到指定的 sheet: {}", sheet_name));
        }
        sheet_name.to_string()
    } else {
        sheet_names[0].clone()
    };

    let range = workbook
        .worksheet_range(&target_sheet)
        .map_err(|err| format!("Excel 读取失败: {}", err))?;

    let merges: Vec<Dimensions> = if let Sheets::Xlsx(ref mut xlsx) = workbook {
        xlsx.worksheet_merge_cells(&target_sheet)
            .and_then(|r| r.ok())
            .unwrap_or_default()
    } else {
        vec![]
    };

    let range_start = range.start().unwrap_or((0, 0));

    let mut all_rows: Vec<Vec<String>> = range
        .rows()
        .map(|row| row.iter().map(cell_to_string).collect::<Vec<String>>())
        .collect();

    fill_merged_cells(&mut all_rows, range_start, &merges);

    if all_rows.is_empty() {
        return Err("Excel 文件为空".to_string());
    }

    let mut headers = Vec::new();
    let data_rows: Vec<Vec<String>>;

    if has_header {
        headers = all_rows[0].clone();
        data_rows = all_rows.into_iter().skip(1).collect();
    } else {
        data_rows = all_rows;
    }

    let mut max_cols = headers.len();
    for row in &data_rows {
        max_cols = max_cols.max(row.len());
    }

    if !has_header {
        if max_cols == 0 {
            return Err("Excel 文件为空".to_string());
        }
        headers = generate_headers(max_cols);
    }

    if headers.len() < max_cols {
        let mut extra_headers = generate_headers(max_cols);
        extra_headers.drain(..headers.len());
        headers.extend(extra_headers);
    }

    let normalized_rows = data_rows
        .into_iter()
        .map(|row| normalize_row(row, headers.len()))
        .collect();

    Ok((target_sheet, headers, normalized_rows))
}

fn row_to_map(headers: &[String], row: &[String]) -> BTreeMap<String, String> {
    headers
        .iter()
        .enumerate()
        .map(|(idx, header)| {
            let value = row.get(idx).cloned().unwrap_or_default();
            (header.clone(), value)
        })
        .collect()
}

#[tauri::command]
fn import_file(request: ImportRequest, state: State<'_, AppState>) -> Result<ImportSummary, String> {
    let path = Path::new(&request.file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    let metadata = fs::metadata(path).map_err(|err| format!("读取文件信息失败: {}", err))?;
    if metadata.len() > MAX_FILE_SIZE_BYTES {
        return Err("文件超过 100MB 限制".to_string());
    }

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_ascii_lowercase())
        .ok_or_else(|| "无法识别文件扩展名".to_string())?;

    let (sheet_name, headers, rows) = match extension.as_str() {
        "csv" => {
            let (headers, rows) = parse_csv(&request.file_path, request.has_header)?;
            (None, headers, rows)
        }
        "xlsx" => {
            let (target_sheet, headers, rows) =
                parse_xlsx(&request.file_path, request.has_header, request.sheet_name.as_deref())?;
            (Some(target_sheet), headers, rows)
        }
        _ => return Err("仅支持 CSV 或 XLSX 文件".to_string()),
    };

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string();

    let summary = ImportSummary {
        file_name: file_name.clone(),
        file_size: metadata.len(),
        rows: rows.len(),
        columns: headers.len(),
        has_header: request.has_header,
        sheet_name: sheet_name.clone(),
    };

    let dataset = DataSet {
        headers,
        rows,
        file_name,
        file_size: metadata.len(),
        has_header: request.has_header,
        sheet_name,
    };

    let mut data_guard = state
        .dataset
        .write()
        .map_err(|_| "状态写入失败".to_string())?;
    *data_guard = Some(dataset);

    Ok(summary)
}

#[tauri::command]
fn list_sheets(request: ListSheetsRequest) -> Result<Vec<String>, String> {
    let path = Path::new(&request.file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_ascii_lowercase())
        .ok_or_else(|| "无法识别文件扩展名".to_string())?;

    if extension != "xlsx" {
        return Ok(Vec::new());
    }

    let workbook = open_workbook_auto(&request.file_path).map_err(|err| format!("Excel 打开失败: {}", err))?;
    Ok(workbook.sheet_names().to_vec())
}

#[tauri::command]
fn preview_rows(limit: usize, state: State<'_, AppState>) -> Result<Vec<BTreeMap<String, String>>, String> {
    let data_guard = state
        .dataset
        .read()
        .map_err(|_| "状态读取失败".to_string())?;
    let dataset = data_guard
        .as_ref()
        .ok_or_else(|| "请先导入文件".to_string())?;

    let actual_limit = limit.min(MAX_PAGE_SIZE);
    let rows = dataset
        .rows
        .iter()
        .take(actual_limit)
        .map(|row| row_to_map(&dataset.headers, row))
        .collect();

    Ok(rows)
}

#[tauri::command]
fn search_rows(request: SearchRequest, state: State<'_, AppState>) -> Result<SearchResponse, String> {
    if request.keyword.trim().is_empty() {
        return Err("关键字不能为空".to_string());
    }
    validate_pagination(request.page, request.page_size)?;

    let data_guard = state
        .dataset
        .read()
        .map_err(|_| "状态读取失败".to_string())?;
    let dataset = data_guard
        .as_ref()
        .ok_or_else(|| "请先导入文件".to_string())?;

    let keyword = request.keyword.to_lowercase();
    let selected_indices: Vec<usize> = match request.columns {
        Some(columns) if !columns.is_empty() => columns
            .iter()
            .filter_map(|name| dataset.headers.iter().position(|header| header == name))
            .collect(),
        _ => (0..dataset.headers.len()).collect(),
    };

    if selected_indices.is_empty() {
        return Err("未找到可检索的列".to_string());
    }

    let matched_rows: Vec<&Vec<String>> = dataset
        .rows
        .iter()
        .filter(|row| {
            selected_indices.iter().any(|&idx| {
                row.get(idx)
                    .map(|value| value.to_lowercase().contains(&keyword))
                    .unwrap_or(false)
            })
        })
        .collect();

    let total = matched_rows.len();
    let start = (request.page - 1) * request.page_size;
    let end = start.saturating_add(request.page_size).min(total);

    let rows = if start >= total {
        Vec::new()
    } else {
        matched_rows[start..end]
            .iter()
            .map(|row| row_to_map(&dataset.headers, row))
            .collect()
    };

    Ok(SearchResponse {
        total,
        page: request.page,
        page_size: request.page_size,
        headers: dataset.headers.clone(),
        rows,
    })
}

#[tauri::command]
fn list_rows(page: usize, page_size: usize, state: State<'_, AppState>) -> Result<SearchResponse, String> {
    validate_pagination(page, page_size)?;

    let data_guard = state
        .dataset
        .read()
        .map_err(|_| "状态读取失败".to_string())?;
    let dataset = data_guard
        .as_ref()
        .ok_or_else(|| "请先导入文件".to_string())?;

    let total = dataset.rows.len();
    let start = (page - 1) * page_size;
    let end = start.saturating_add(page_size).min(total);

    let rows = if start >= total {
        Vec::new()
    } else {
        dataset.rows[start..end]
            .iter()
            .map(|row| row_to_map(&dataset.headers, row))
            .collect()
    };

    Ok(SearchResponse {
        total,
        page,
        page_size,
        headers: dataset.headers.clone(),
        rows,
    })
}

#[tauri::command]
fn clear_dataset(state: State<'_, AppState>) -> Result<(), String> {
    let mut data_guard = state
        .dataset
        .write()
        .map_err(|_| "状态写入失败".to_string())?;
    *data_guard = None;
    Ok(())
}

#[tauri::command]
fn get_dataset_info(state: State<'_, AppState>) -> Result<Option<ImportSummary>, String> {
    let data_guard = state
        .dataset
        .read()
        .map_err(|_| "状态读取失败".to_string())?;

    Ok(data_guard.as_ref().map(|dataset| ImportSummary {
        file_name: dataset.file_name.clone(),
        file_size: dataset.file_size,
        rows: dataset.rows.len(),
        columns: dataset.headers.len(),
        has_header: dataset.has_header,
        sheet_name: dataset.sheet_name.clone(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_sheets,
            import_file,
            preview_rows,
            search_rows,
            list_rows,
            clear_dataset,
            get_dataset_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
