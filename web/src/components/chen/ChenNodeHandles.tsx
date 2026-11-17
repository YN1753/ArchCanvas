import { Handle, Position } from '@xyflow/react'
import { memo } from 'react'

export interface ChenNodeHandlesProps {
  mode?: 'bidirectional' | 'target-only'
  pinToVertices?: boolean
  size?: 'sm' | 'md'
}

const DIRECTIONS = [
  { key: 'top', position: Position.Top, pinClass: '!top-0' },
  { key: 'right', position: Position.Right, pinClass: '!right-0' },
  { key: 'bottom', position: Position.Bottom, pinClass: '!bottom-0' },
  { key: 'left', position: Position.Left, pinClass: '!left-0' },
] as const

/**
 * 陈氏 ER 图三类图元（实体矩形、联系菱形、属性椭圆）共享的声明式锚点组件。
 * 严格与 `flow/chen/geometry.ts` 产出的 `<dir>-source` / `<dir>-target` Handle ID 一一对齐，
 * 移除原先每个节点冗余未使用的 4 个裸方向 Handle。
 */
function ChenNodeHandles({
  mode = 'bidirectional',
  pinToVertices = false,
  size = 'md',
}: ChenNodeHandlesProps) {
  const sizeClass = size === 'sm' ? '!h-1.5 !w-1.5' : '!h-2 !w-2'
  const baseClass = `${sizeClass} !border-none !bg-transparent`

  return (
    <>
      {DIRECTIONS.map((dir) => {
        const cls = pinToVertices ? `${dir.pinClass} ${baseClass}` : baseClass
        return (
          <span key={dir.key} className="contents">
            {mode === 'bidirectional' && (
              <Handle
                type="source"
                position={dir.position}
                id={`${dir.key}-source`}
                className={dir.key === 'left' && !pinToVertices ? `!left-0 ${cls}` : cls}
              />
            )}
            <Handle
              type="target"
              position={dir.position}
              id={`${dir.key}-target`}
              className={cls}
            />
          </span>
        )
      })}
    </>
  )
}

export default memo(ChenNodeHandles)
