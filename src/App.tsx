import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ImportSummary,
  RowData,
  SearchRequest,
  SearchResponse,
} from "./types";
import "./App.css";

function App() {
  const [filePath, setFilePath] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [keyword, setKeyword] = useState("");
  const [columnsInput, setColumnsInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const headers = useMemo(() => {
    if (rows.length === 0) {
      return [];
    }
    return Object.keys(rows[0]);
  }, [rows]);

  const totalPages = useMemo(() => {
    if (pageSize === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total, pageSize]);

  const selectedFileName = useMemo(() => {
    if (!filePath) {
      return "未选择文件";
    }

    const segments = filePath.split(/[/\\]/);
    return segments[segments.length - 1] || filePath;
  }, [filePath]);

  const isXlsx = useMemo(() => filePath.toLowerCase().endsWith(".xlsx"), [filePath]);

  function formatFileSize(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  async function importFile(targetFilePath: string, targetSheet?: string) {
    if (!targetFilePath.trim()) {
      setError("请先选择文件");
      return;
    }
    if (targetFilePath.toLowerCase().endsWith(".xlsx") && !targetSheet) {
      setError("请选择需要导入的 sheet");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await invoke<ImportSummary>("import_file", {
        request: {
          filePath: targetFilePath,
          hasHeader,
          sheetName: targetFilePath.toLowerCase().endsWith(".xlsx") ? targetSheet : undefined,
        },
      });
      setSummary(data);
      const result = await invoke<SearchResponse>("list_rows", {
        page: 1,
        pageSize,
      });
      setRows(result.rows);
      setTotal(data.rows);
      setPage(1);
      setKeyword("");
      setColumnsInput("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function pickFile() {
    setError("");
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Data Files", extensions: ["csv", "xlsx"] },
          { name: "CSV", extensions: ["csv"] },
          { name: "Excel", extensions: ["xlsx"] },
        ],
      });

      if (typeof selected === "string") {
        setFilePath(selected);
        setSummary(null);
        setRows([]);
        setTotal(0);
        setPage(1);

        if (selected.toLowerCase().endsWith(".xlsx")) {
          const sheets = await invoke<string[]>("list_sheets", {
            request: { filePath: selected },
          });
          setSheetNames(sheets);
          const defaultSheet = sheets[0] ?? "";
          setSelectedSheet(defaultSheet);
          if (defaultSheet) {
            await importFile(selected, defaultSheet);
          }
        } else {
          setSheetNames([]);
          setSelectedSheet("");
          await importFile(selected);
        }
      }
    } catch (err) {
      setError(`文件选择失败: ${String(err)}`);
    }
  }

  async function handleSheetChange(nextSheet: string) {
    setSelectedSheet(nextSheet);
    if (filePath && nextSheet) {
      await importFile(filePath, nextSheet);
    }
  }

  async function clearAll() {
    setLoading(true);
    setError("");
    try {
      await invoke("clear_dataset");
      setSummary(null);
      setRows([]);
      setKeyword("");
      setColumnsInput("");
      setTotal(0);
      setPage(1);
      setFilePath("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshByPage(
    nextPageValue: number,
    nextPageSize: number,
    keywordOverride?: string,
  ) {
    setLoading(true);
    setError("");
    try {
      const trimmedKeyword = (keywordOverride ?? keyword).trim();
      const result = trimmedKeyword
        ? await invoke<SearchResponse>("search_rows", {
            request: {
              keyword: trimmedKeyword,
              page: nextPageValue,
              pageSize: nextPageSize,
              columns: columnsInput
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            } satisfies SearchRequest,
          })
        : await invoke<SearchResponse>("list_rows", {
            page: nextPageValue,
            pageSize: nextPageSize,
          });

      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePageSizeChange(next: number) {
    setPageSize(next);
    setPage(1);
    await refreshByPage(1, next);
  }

  async function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPage(1);
    await refreshByPage(1, pageSize);
  }

  async function handleKeywordChange(nextKeyword: string) {
    setKeyword(nextKeyword);

    if (!nextKeyword.trim() && summary) {
      setPage(1);
      await refreshByPage(1, pageSize, "");
    }
  }

  async function handlePrevPage() {
    const next = page - 1;
    if (next < 1) {
      return;
    }
    setPage(next);
    await refreshByPage(next, pageSize);
  }

  async function handleNextPage() {
    const next = page + 1;
    if (next > totalPages) {
      return;
    }
    setPage(next);
    await refreshByPage(next, pageSize);
  }

  return (
    <main className="app">
      <h1>数据检索工具</h1>
      <p className="subtitle">支持 CSV / XLSX，支持有表头与无表头格式</p>

      <section className="panel">
        <h2>1. 导入文件</h2>
        <div className="controls">
          <button type="button" onClick={pickFile} disabled={loading}>
            从系统文件管理器选择
          </button>
        </div>
        <div className="file-selection-card">
          <p className="file-selection-label">当前选择</p>
          <p className="file-selection-name">{selectedFileName}</p>
          <p className="file-selection-path">{filePath || "点击上方按钮后，将弹出 Windows 原生文件选择窗口。"}</p>
        </div>
        {isXlsx ? (
          <div className="controls">
            <label>
              Sheet
              <select
                value={selectedSheet}
                onChange={(e) => {
                  void handleSheetChange(e.currentTarget.value);
                }}
                disabled={loading || sheetNames.length === 0}
              >
                {sheetNames.length === 0 ? <option value="">无可用 sheet</option> : null}
                {sheetNames.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.currentTarget.checked)}
          />
          文件包含表头（无表头请取消勾选）
        </label>
        <div className="controls">
          <button type="button" onClick={clearAll} disabled={loading}>
            清空数据
          </button>
        </div>
        {summary ? (
          <p className="meta">
            已导入：{summary.fileName} | 行数：{summary.rows} | 列数：
            {summary.columns}
            {summary.sheetName ? ` | Sheet：${summary.sheetName}` : ""} | 大小：
            {formatFileSize(summary.fileSize)}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>2. 关键字检索</h2>
        <form onSubmit={handleSearchSubmit}>
          <div className="controls">
            <input
              value={keyword}
              onChange={(e) => {
                void handleKeywordChange(e.currentTarget.value);
              }}
              placeholder="输入关键字（包含匹配，大小写不敏感）"
            />
            <input
              value={columnsInput}
              onChange={(e) => setColumnsInput(e.currentTarget.value)}
              placeholder="指定列名（可选，逗号分隔）"
            />
          </div>
          <div className="controls">
            <label>
              每页
              <select
                value={pageSize}
                onChange={(e) => {
                  void handlePageSizeChange(Number(e.currentTarget.value));
                }}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <button type="submit" disabled={loading}>
              检索
            </button>
          </div>
        </form>

        <div className="pagination">
          <button type="button" onClick={handlePrevPage} disabled={loading || page <= 1}>
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页，共 {total} 条命中
          </span>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={loading || page >= totalPages}
          >
            下一页
          </button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        <h2>3. 结果</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {headers.map((header) => (
                    <td key={`${idx}-${header}`}>{row[header]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
