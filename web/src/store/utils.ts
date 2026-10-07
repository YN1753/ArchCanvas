import { ApiError } from '../api/client'
import type { BusinessConcept, Entity, ERDesign, Position } from '../types/dsl'

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function loadChenPositions(projectId: string): Record<string, Position> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`archcanvas_chen_pos_${projectId}`)
      if (raw) {
        return JSON.parse(raw)
      }
    }
  } catch {}
  return {}
}

export function saveChenPositions(projectId: string, positions: Record<string, Position>) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`archcanvas_chen_pos_${projectId}`, JSON.stringify(positions))
    }
  } catch {}
}

export function uniqueEntityName(design: ERDesign, base: string): string {
  const used = new Set(design.entities.map((entity) => entity.name.toLowerCase()))
  if (!used.has(base)) {
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

export function uniqueFieldName(entity: Entity, base: string): string {
  const used = new Set(entity.attributes.map((attribute) => attribute.name.toLowerCase()))
  if (!used.has(base)) {
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

export function uniqueConceptName(concepts: BusinessConcept[], base = 'NewConcept'): string {
  const used = new Set(concepts.map((c) => c.name.toLowerCase()))
  if (!used.has(base.toLowerCase())) {
    return base
  }
  let index = 2
  while (used.has(`${base.toLowerCase()}${index}`)) {
    index += 1
  }
  return `${base}${index}`
}

export function uniqueConceptAttrName(concept: BusinessConcept, base = 'prop'): string {
  const used = new Set((concept.attributes || []).map((a) => a.name.toLowerCase()))
  if (!used.has(base.toLowerCase())) {
    return base
  }
  let index = 2
  while (used.has(`${base.toLowerCase()}${index}`)) {
    index += 1
  }
  return `${base}${index}`
}
