const KEY = 'texpad_view_prefs'

export type LayoutMode = 'split' | 'editor' | 'pdf'

export type PdfFitMode = 'none' | 'width' | 'height'

export type ViewPrefs = {
  layoutMode: LayoutMode
  showBreadcrumbs: boolean
  showEquationPreview: boolean
  pdfPresentationMode: boolean
  /** 应用为深色界面时，是否反色内嵌 PDF 预览（便于夜间阅读白底 PDF） */
  pdfInvertInDarkMode: boolean
  /** 用户缩放倍率（相对 1） */
  pdfZoom: number
  pdfFit: PdfFitMode
}

const defaults: ViewPrefs = {
  layoutMode: 'split',
  showBreadcrumbs: true,
  showEquationPreview: true,
  pdfPresentationMode: false,
  pdfInvertInDarkMode: false,
  pdfZoom: 1,
  pdfFit: 'none',
}

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const j = JSON.parse(raw) as Partial<ViewPrefs>
    const layoutMode =
      j.layoutMode === 'editor' || j.layoutMode === 'pdf' || j.layoutMode === 'split' ? j.layoutMode : defaults.layoutMode
    const pdfZoom = typeof j.pdfZoom === 'number' && Number.isFinite(j.pdfZoom) ? Math.min(3, Math.max(0.35, j.pdfZoom)) : defaults.pdfZoom
    const pdfFit =
      j.pdfFit === 'width' || j.pdfFit === 'height' || j.pdfFit === 'none' ? j.pdfFit : defaults.pdfFit
    return {
      layoutMode,
      showBreadcrumbs: typeof j.showBreadcrumbs === 'boolean' ? j.showBreadcrumbs : defaults.showBreadcrumbs,
      showEquationPreview:
        typeof j.showEquationPreview === 'boolean' ? j.showEquationPreview : defaults.showEquationPreview,
      pdfPresentationMode:
        typeof j.pdfPresentationMode === 'boolean' ? j.pdfPresentationMode : defaults.pdfPresentationMode,
      pdfInvertInDarkMode:
        typeof j.pdfInvertInDarkMode === 'boolean' ? j.pdfInvertInDarkMode : defaults.pdfInvertInDarkMode,
      pdfZoom,
      pdfFit,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveViewPrefs(p: ViewPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}
