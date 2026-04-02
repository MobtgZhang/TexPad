import { useEffect } from 'react'

type Shortcut = { keys: string; desc: string }

function Section(props: { title: string; items: Shortcut[] }) {
  return (
    <section className="editor-hotkeys-section">
      <h3 className="editor-hotkeys-section__title">{props.title}</h3>
      <ul className="editor-hotkeys-grid">
        {props.items.map((row) => (
          <li key={`${props.title}-${row.keys}`} className="editor-hotkeys-item">
            <kbd className="editor-hotkeys-kbd">{row.keys}</kbd>
            <span className="editor-hotkeys-desc">{row.desc}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const SECTIONS: { title: string; items: Shortcut[] }[] = [
  {
    title: '常用',
    items: [
      { keys: 'Ctrl + F', desc: '查找（与替换）' },
      { keys: 'Ctrl + S', desc: '保存并编译' },
      { keys: 'Ctrl + Z', desc: '撤销' },
      { keys: 'Ctrl + Y', desc: '重做' },
      { keys: 'Ctrl + Enter', desc: '编译' },
    ],
  },
  {
    title: '导航',
    items: [
      { keys: 'Ctrl + Home', desc: '文档开头' },
      { keys: 'Ctrl + End', desc: '文档末尾' },
      { keys: 'Ctrl + Shift + L', desc: '跳转到行' },
    ],
  },
  {
    title: '编辑',
    items: [
      { keys: 'Ctrl + /', desc: '切换行注释' },
      { keys: 'Ctrl + U', desc: '转为大写' },
      { keys: 'Ctrl + B', desc: '粗体（\\textbf{}）' },
      { keys: 'Ctrl + D', desc: '删除当前行' },
      { keys: 'Ctrl + Shift + U', desc: '转为小写' },
      { keys: 'Ctrl + I', desc: '斜体（\\textit{}）' },
      { keys: 'Ctrl + A', desc: '全选' },
      { keys: 'Tab', desc: '缩进选区' },
    ],
  },
  {
    title: '自动补全',
    items: [
      { keys: 'Ctrl + Space', desc: '打开补全菜单' },
      { keys: '↑ / ↓', desc: '选择候选' },
      { keys: 'Enter / Tab', desc: '插入候选' },
    ],
  },
  {
    title: '参考文献（在 \\cite{} 内）',
    items: [{ keys: 'Ctrl + Space', desc: '搜索参考文献（触发补全）' }],
  },
  {
    title: '评论',
    items: [
      { keys: 'Ctrl + J', desc: '打开左侧评论面板' },
      { keys: 'Ctrl + Shift + A', desc: '切换修订追踪（占位）' },
      { keys: 'Ctrl + Shift + C', desc: '打开左侧评论面板' },
    ],
  },
]

export default function EditorHotkeysModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="editor-hotkeys-scrim" aria-hidden onClick={onClose} />
      <div className="editor-hotkeys-dialog" role="dialog" aria-modal="true" aria-labelledby="hotkeys-title">
        <div className="editor-hotkeys-head">
          <h2 id="hotkeys-title" className="editor-hotkeys-title">
            快捷键
          </h2>
          <button type="button" className="editor-hotkeys-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="editor-hotkeys-body">
          {SECTIONS.map((s) => (
            <Section key={s.title} title={s.title} items={s.items} />
          ))}
          <div className="editor-hotkeys-footnote">
            <p>
              在 macOS 上 <strong>Ctrl</strong> 组合键与 <strong>Cmd (⌘)</strong> 等价（由编辑器统一映射）。部分审阅相关能力仍在接入中。
            </p>
          </div>
        </div>
        <div className="editor-hotkeys-actions">
          <button type="button" className="editor-hotkeys-btn-close" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </>
  )
}
