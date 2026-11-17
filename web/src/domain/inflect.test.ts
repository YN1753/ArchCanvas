import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toCamelCase, toPascalCase, toPlural, toSingular, toSnakeCase } from './inflect'

describe('Shared Inflection & Naming Kernel', () => {
  it('handles compound snake_case by singularizing/pluralizing only the final segment', () => {
    assert.equal(toSingular('user_roles'), 'user_role')
    assert.equal(toSingular('order_items'), 'order_item')
    assert.equal(toSingular('role_permissions'), 'role_permission')
    assert.equal(toSingular('media_resources'), 'media_resource')
    assert.equal(toPlural('user_role'), 'user_roles')
    assert.equal(toPlural('order_item'), 'order_items')
  })

  it('preserves uncountables, acronyms, and -ss/-us/-is singulars', () => {
    const preserved = [
      'status',
      'series',
      'species',
      'news',
      'data',
      'media',
      'campus',
      'virus',
      'corpus',
      'census',
      'alias',
      'canvas',
      'sms',
      'dns',
      'cors',
      'rbac',
      'cms',
      'wms',
      'oms',
      'tms',
      'erp',
      'pos',
      'ibs',
      'oss',
      'address',
      'access',
      'process',
      'business',
      'class',
      'pass',
      'express',
      'analysis',
      'basis',
      'diagnosis',
    ]
    for (const word of preserved) {
      assert.equal(toSingular(word), word, `expected ${word} to remain singular`)
    }
  })

  it('maps irregular nouns bidirectionally', () => {
    const pairs: Array<[string, string]> = [
      ['people', 'person'],
      ['men', 'man'],
      ['women', 'woman'],
      ['children', 'child'],
      ['teeth', 'tooth'],
      ['feet', 'foot'],
      ['mice', 'mouse'],
      ['geese', 'goose'],
      ['vertices', 'vertex'],
      ['matrices', 'matrix'],
      ['criteria', 'criterion'],
      ['phenomena', 'phenomenon'],
      ['leaves', 'leaf'],
      ['lives', 'life'],
      ['knives', 'knife'],
      ['wolves', 'wolf'],
      ['shelves', 'shelf'],
      ['halves', 'half'],
    ]
    for (const [plural, singular] of pairs) {
      assert.equal(toSingular(plural), singular)
      assert.equal(toSingular(singular), singular)
      assert.equal(toPlural(singular), plural)
      assert.equal(toPlural(plural), plural)
    }
    assert.equal(toSingular('indices'), 'index')
    assert.equal(toSingular('indexes'), 'index')
  })

  it('handles -ies -> -y while preserving -ie root nouns', () => {
    const iesPairs: Array<[string, string]> = [
      ['categories', 'category'],
      ['companies', 'company'],
      ['policies', 'policy'],
      ['inventories', 'inventory'],
      ['entries', 'entry'],
      ['histories', 'history'],
      ['deliveries', 'delivery'],
      ['authorities', 'authority'],
      ['activities', 'activity'],
      ['dictionaries', 'dictionary'],
    ]
    for (const [plural, singular] of iesPairs) {
      assert.equal(toSingular(plural), singular)
      assert.equal(toPlural(singular), plural)
    }
    assert.equal(toSingular('movies'), 'movie')
    assert.equal(toSingular('cookies'), 'cookie')
    assert.equal(toSingular('series'), 'series')
    assert.equal(toSingular('species'), 'species')
  })

  it('distinguishes -es stripping from silent -e roots (-se/-ce)', () => {
    const esPairs: Array<[string, string]> = [
      ['addresses', 'address'],
      ['classes', 'class'],
      ['processes', 'process'],
      ['businesses', 'business'],
      ['boxes', 'box'],
      ['batches', 'batch'],
      ['wishes', 'wish'],
      ['statuses', 'status'],
      ['campuses', 'campus'],
      ['bonuses', 'bonus'],
      ['viruses', 'virus'],
      ['aliases', 'alias'],
      ['canvases', 'canvas'],
    ]
    for (const [plural, singular] of esPairs) {
      assert.equal(toSingular(plural), singular)
      assert.equal(toPlural(singular), plural)
    }

    const silentEPairs: Array<[string, string]> = [
      ['warehouses', 'warehouse'],
      ['invoices', 'invoice'],
      ['releases', 'release'],
      ['courses', 'course'],
      ['licenses', 'license'],
      ['cases', 'case'],
      ['phases', 'phase'],
      ['purchases', 'purchase'],
      ['expenses', 'expense'],
      ['responses', 'response'],
      ['enterprises', 'enterprise'],
      ['resources', 'resource'],
    ]
    for (const [plural, singular] of silentEPairs) {
      assert.equal(toSingular(plural), singular, `${plural} should strip only s -> ${singular}`)
      assert.equal(toPlural(singular), plural)
    }
  })

  it('converts snake_case, PascalCase, and camelCase accurately', () => {
    assert.equal(toSnakeCase('UserRolePermission'), 'user_role_permission')
    assert.equal(toSnakeCase('HTTPServerConfig'), 'http_server_config')
    assert.equal(toPascalCase('order_items'), 'OrderItems')
    assert.equal(toCamelCase('order_item_id'), 'orderItemId')
  })
})
