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

  function formatFileSize(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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
      }
    } catch (err) {
      setError(`文件选择失败: ${String(err)}`);
    }
  }

  async function importFile() {
    if (!filePath.trim()) {
      setError("请先选择文件");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await invoke<ImportSummary>("import_file", {
        request: {
          filePath,
          hasHeader,
        },
      });
      setSummary(data);
      setPage(1);
      const result = await invoke<SearchResponse>("list_rows", {
        page: 1,
        pageSize,
      });
      setRows(result.rows);
      setTotal(data.rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.currentTarget.checked)}
          />
          文件包含表头（无表头请取消勾选）
        </label>
        <div className="controls">
          <button type="button" onClick={importFile} disabled={loading}>
            {loading ? "处理中..." : "导入"}
          </button>
          <button type="button" onClick={clearAll} disabled={loading}>
            清空数据
          </button>
        </div>
        {summary ? (
          <p className="meta">
            已导入：{summary.fileName} | 行数：{summary.rows} | 列数：
            {summary.columns} | 大小：{formatFileSize(summary.fileSize)}
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
