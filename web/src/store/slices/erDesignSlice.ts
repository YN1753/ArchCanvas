import type { StateCreator } from 'zustand'

import { ensureLayout, layoutDesign, placeNewEntities } from '../../flow/layout'
import { defaultCodeType, localID, type Entity, type ERDesign, type Relation } from '../../types/dsl'
import type { ErDesignSlice, Store } from '../types'
import { saveChenPositions, uniqueEntityName, uniqueFieldName } from '../utils'

export const createErDesignSlice: StateCreator<Store, [], [], ErDesignSlice> = (set, get) => ({
  design: { entities: [], relations: [] },
  report: { errors: [], warnings: [] },

  moveEntity(id, position) {
    get().withEntities((entities) =>
      entities.map((entity) => (entity.id === id ? { ...entity, position } : entity)),
    )
  },

  moveEntities(moves) {
    if (moves.length === 0) return
    const moveMap = new Map(moves.map((m) => [m.id, m.position]))
    get().withEntities((entities) =>
      entities.map((entity) => {
        const pos = moveMap.get(entity.id)
        return pos ? { ...entity, position: pos } : entity
      }),
    )
  },

  addEntity(customPosition) {
    const { design } = get()
    const name = uniqueEntityName(design, 'new_table')
    const entity: Entity = {
      id: localID('ent'),
      name,
      position: customPosition
        ? {
            x: Math.round(customPosition.x / 20) * 20,
            y: Math.round(customPosition.y / 20) * 20,
          }
        : undefined,
      attributes: [
        {
          id: localID('attr'),
          name: 'id',
          db_type: 'BIGINT',
          code_type: 'uint64',
          is_primary_key: true,
          is_nullable: false,
          is_unique: false,
          description: '主键',
        },
      ],
    }

    const placed = customPosition
      ? { ...design, entities: [...design.entities, entity] }
      : placeNewEntities(
          { ...design, entities: [...design.entities, entity] },
          [entity.id],
        )

    get().mutate(placed, undefined, {
      selection: { kind: 'entity', id: entity.id },
      inspectorOpen: true,
    })
    return entity.id
  },

  renameEntity(id, name) {
    get().withEntities(
      (entities) => entities.map((entity) => (entity.id === id ? { ...entity, name } : entity)),
      `rename_${id}`,
    )
  },

  updateEntity(id, patch) {
    get().withEntities(
      (entities) => entities.map((entity) => (entity.id === id ? { ...entity, ...patch } : entity)),
      `update_entity_${id}`,
    )
  },

  deleteEntity(id) {
    const { design, selection, chenPositions, project } = get()
    const removedRelationIDs = new Set(
      design.relations
        .filter((relation) => relation.source_entity_id === id || relation.target_entity_id === id)
        .map((relation) => relation.id),
    )
    const next: ERDesign = {
      entities: design.entities.filter((entity) => entity.id !== id),
      relations: design.relations.filter((relation) => !removedRelationIDs.has(relation.id)),
    }
    const removedRelations = removedRelationIDs.size
    const nextChenPositions = { ...chenPositions }
    delete nextChenPositions[id]
    delete nextChenPositions[`junction-${id}`]
    for (const relId of removedRelationIDs) {
      delete nextChenPositions[`rel-${relId}`]
    }
    for (const key of Object.keys(nextChenPositions)) {
      if (key.startsWith(`attr-${id}-`)) {
        delete nextChenPositions[key]
      }
    }
    if (project) {
      saveChenPositions(project.id, nextChenPositions)
    }

    const nextSelection =
      (selection?.kind === 'entity' && selection.id === id) ||
      (selection?.kind === 'relation' && removedRelationIDs.has(selection.id))
        ? null
        : selection

    get().mutate(next, undefined, {
      chenPositions: nextChenPositions,
      selection: nextSelection,
      ...(removedRelations > 0
        ? {
            toast: {
              kind: 'info',
              text: `已删除实体，并连带移除 ${removedRelations} 条关系`,
            },
          }
        : {}),
    })
  },

  addAttribute(entityID) {
    get().withEntities((entities) =>
      entities.map((entity) =>
        entity.id === entityID
          ? {
              ...entity,
              attributes: [
                ...entity.attributes,
                {
                  id: localID('attr'),
                  name: uniqueFieldName(entity, 'field'),
                  db_type: 'VARCHAR(255)',
                  code_type: 'string',
                  is_primary_key: false,
                  is_nullable: true,
                  is_unique: false,
                  description: '',
                },
              ],
            }
          : entity,
      ),
    )
  },

  updateAttribute(entityID, attributeID, patch) {
    get().withEntities(
      (entities) =>
        entities.map((entity) => {
          if (entity.id !== entityID) {
            return entity
          }
          return {
            ...entity,
            attributes: entity.attributes.map((attribute) => {
              if (attribute.id !== attributeID) {
                return attribute
              }
              const next = { ...attribute, ...patch }
              // 改了数据库类型但没显式改 Go 类型时，同步推导，避免两者长期漂移。
              if (patch.db_type !== undefined && patch.code_type === undefined) {
                next.code_type = defaultCodeType(patch.db_type)
              }
              if (next.is_primary_key) {
                next.is_nullable = false
              }
              return next
            }),
          }
        }),
      `attr_${entityID}_${attributeID}`,
    )
  },

  deleteAttribute(entityID, attributeID) {
    get().withEntities((entities) =>
      entities.map((entity) =>
        entity.id === entityID
          ? {
              ...entity,
              attributes: entity.attributes.filter((attribute) => attribute.id !== attributeID),
            }
          : entity,
      ),
    )
  },

  moveAttribute(entityID, attributeID, direction) {
    get().withEntities((entities) =>
      entities.map((entity) => {
        if (entity.id !== entityID) {
          return entity
        }
        const index = entity.attributes.findIndex((attribute) => attribute.id === attributeID)
        const target = index + direction
        if (index < 0 || target < 0 || target >= entity.attributes.length) {
          return entity
        }
        const attributes = [...entity.attributes]
        const [moved] = attributes.splice(index, 1)
        attributes.splice(target, 0, moved)
        return { ...entity, attributes }
      }),
    )
  },

  addRelation(sourceEntityID, targetEntityID) {
    const { design } = get()
    const isSelf = sourceEntityID === targetEntityID
    const duplicate = design.relations.some(
      (relation) =>
        relation.source_entity_id === sourceEntityID && relation.target_entity_id === targetEntityID,
    )
    if (duplicate) {
      set({
        toast: {
          kind: 'error',
          text: isSelf ? '该实体已存在自引用关系' : '这两个实体之间已经存在同方向的关系',
        },
      })
      return
    }

    const relation: Relation = {
      id: localID('rel'),
      source_entity_id: sourceEntityID,
      target_entity_id: targetEntityID,
      cardinality: 'one_to_many',
    }
    get().mutate(
      { ...design, relations: [...design.relations, relation] },
      undefined,
      {
        selection: { kind: 'relation', id: relation.id },
        inspectorOpen: true,
      },
    )
  },

  updateRelation(id, patch) {
    const { design } = get()
    get().mutate(
      {
        ...design,
        relations: design.relations.map((relation) =>
          relation.id === id ? { ...relation, ...patch } : relation,
        ),
      },
      `update_relation_${id}`,
    )
  },

  deleteRelation(id) {
    const { design, selection, chenPositions, project } = get()
    const nextChenPositions = { ...chenPositions }
    delete nextChenPositions[`rel-${id}`]
    if (project) {
      saveChenPositions(project.id, nextChenPositions)
    }
    get().mutate(
      {
        ...design,
        relations: design.relations.filter((relation) => relation.id !== id),
      },
      undefined,
      {
        chenPositions: nextChenPositions,
        selection: selection?.kind === 'relation' && selection.id === id ? null : selection,
      },
    )
  },

  autoLayout() {
    const { design } = get()
    get().mutate(layoutDesign(design))
  },

  importDesign(design) {
    get().mutate(ensureLayout(design), undefined, {
      selection: null,
      aiResult: null,
      aiError: null,
    })
  },
})
