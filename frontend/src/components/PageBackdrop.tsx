import type { ReactNode } from 'react'

type Align = 'center' | 'top'

export default function PageBackdrop({
  children,
  align = 'center',
}: {
  children: ReactNode
  align?: Align
}) {
  const innerClass =
    align === 'top' ? 'page-backdrop__inner page-backdrop__inner--top' : 'page-backdrop__inner'
  return (
    <div className="page-backdrop">
      <div className="page-backdrop__glow page-backdrop__glow--a" aria-hidden />
      <div className="page-backdrop__glow page-backdrop__glow--b" aria-hidden />
      <div className="page-backdrop__glow page-backdrop__glow--c" aria-hidden />
      <div className={innerClass}>{children}</div>
    </div>
  )
}
