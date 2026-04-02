type FileEnt = { path: string; size_bytes?: number }

export default function EditorProjectSearch(props: {
  files: FileEnt[]
  query: string
  onQuery: (q: string) => void
  onOpenFile: (path: string) => void
}) {
  const { files, query, onQuery, onOpenFile } = props
  const q = query.trim().toLowerCase()
  const list = !q ? files : files.filter((f) => f.path.toLowerCase().includes(q))

  return (
    <div className="editor-proj-search">
      <div className="editor-proj-search-head">项目查找</div>
      <input
        type="search"
        className="editor-proj-search-input"
        placeholder="按路径筛选文件…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        aria-label="查找项目文件"
      />
      <ul className="editor-proj-search-list" role="listbox">
        {list.length === 0 ? (
          <li className="editor-proj-search-empty">无匹配文件</li>
        ) : (
          list.map((f) => (
            <li key={f.path}>
              <button type="button" className="editor-proj-search-hit" onClick={() => onOpenFile(f.path)}>
                {f.path}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
