import { useMemo } from 'react'

import { useStore } from '../../store/erStore'
import { SectionTitle } from './shared'

export default function OverviewInspector() {
  const design = useStore((state) => state.design)
  const report = useStore((state) => state.report)
  const serverWarnings = useStore((state) => state.serverWarnings)

  const warnings = useMemo(
    () => Array.from(new Set([...report.warnings, ...serverWarnings])),
    [report.warnings, serverWarnings],
  )

  const pkCount = design.entities.filter((e) => e.attributes.some((a) => a.is_primary_key)).length
  const pkCoverage =
    design.entities.length > 0 ? Math.round((pkCount / design.entities.length) * 100) : 100

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>设计健康度看板</SectionTitle>
        <div className="grid grid-cols-3 gap-2 text-center mt-2">
          <div className="rounded-lg bg-[#faf7f0] p-2 border-[1.5px] border-[#1f1f1f]">
            <div className="text-base font-bold text-[#1f1f1f]">{design.entities.length}</div>
            <div className="text-[10px] text-stone-500 mt-0.5">实体表</div>
          </div>
          <div className="rounded-lg bg-[#faf7f0] p-2 border-[1.5px] border-[#1f1f1f]">
            <div className="text-base font-bold text-[#1f1f1f]">{design.relations.length}</div>
            <div className="text-[10px] text-stone-500 mt-0.5">关联关系</div>
          </div>
          <div className="rounded-lg bg-[#faf7f0] p-2 border-[1.5px] border-[#1f1f1f]">
            <div className="text-base font-bold text-emerald-600">{pkCoverage}%</div>
            <div className="text-[10px] text-stone-500 mt-0.5">主键覆盖</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>规则校验诊断</SectionTitle>

        {report.errors.length > 0 ? (
          <div className="space-y-1.5 mb-3">
            <span className="text-[10px] font-bold text-rose-700">
              阻止落库错误（{report.errors.length}）
            </span>
            {report.errors.map((err) => (
              <div
                key={err}
                className="rounded-lg border-[1.5px] border-rose-300 bg-rose-50 p-2 text-[11px] leading-relaxed text-rose-700"
              >
                · {err}
              </div>
            ))}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-amber-700">
              优化建议（{warnings.length}）
            </span>
            {warnings.map((warn) => (
              <div
                key={warn}
                className="rounded-lg border-[1.5px] border-amber-300 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-700"
              >
                · {warn}
              </div>
            ))}
          </div>
        ) : null}

        {report.errors.length === 0 && warnings.length === 0 ? (
          <div className="rounded-lg border-[1.5px] border-emerald-300 bg-emerald-50/80 p-3 text-center text-xs font-medium text-emerald-700">
            ✓ 结构符合数据库物理建模最佳规范
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border-[1.5px] border-dashed border-stone-400 bg-white/60 p-3 text-[11px] text-stone-600 leading-relaxed flex items-center gap-2">
        <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          提示：点击画布中的任意实体表节点或连线，即可在此展开专属字段编辑与即时 SQL 预览。
        </span>
      </div>
    </div>
  )
}
