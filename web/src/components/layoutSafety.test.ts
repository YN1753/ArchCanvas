import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const componentsDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.dirname(componentsDir)

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(componentsDir, relPath), 'utf8')
}

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

describe('UI Layout & Overlay Clipping Regression Guards', () => {
  it('portals all dropdown/combobox/popover components via useAnchoredFloating instead of overflow-clipped absolute panels', () => {
    const overlayFiles = [
      'ProjectMenu.tsx',
      'Combobox.tsx',
      'Select.tsx',
      'ModelSelector.tsx',
    ]

    for (const file of overlayFiles) {
      const src = readComponent(file)
      assert.match(
        src,
        /useAnchoredFloating\(/,
        `${file} must position its overlay with useAnchoredFloating`,
      )
      assert.match(
        src,
        /createPortal\(/,
        `${file} must render its overlay inside a Portal so overflow-auto/hidden parents cannot clip it`,
      )
      assert.doesNotMatch(
        src,
        /\b(top-full|bottom-full)\b/,
        `${file} must not regress to unportaled top-full/bottom-full positioning`,
      )
    }
  })

  it('keeps desktop Toolbar header overflow-visible so header items do not vertically clip anchored triggers', () => {
    const toolbarSrc = readComponent('Toolbar.tsx')
    assert.match(
      toolbarSrc,
      /<header\b[^>]*lg:overflow-visible/,
      'Toolbar <header> must allow overflow-visible on lg+ viewports',
    )
    assert.doesNotMatch(
      toolbarSrc,
      /<header\b[^>]*\boverflow-x-auto\b(?!.*lg:overflow-visible)/,
      'Toolbar <header> must never force CSS overflow-y auto on desktop',
    )
  })

  it('positions collapsible drawers below the Toolbar (absolute inset-y-0) and marks closed drawers inert', () => {
    const aiSidebarSrc = readComponent('ai/AiSidebar.tsx')
    const inspectorShellSrc = readComponent('inspector/InspectorShell.tsx')

    for (const [name, src] of [
      ['AiSidebar.tsx', aiSidebarSrc],
      ['InspectorShell.tsx', inspectorShellSrc],
    ] as const) {
      assert.doesNotMatch(
        src,
        /\bfixed\s+inset-y-0\b/,
        `${name} must use absolute inset-y-0 inside App workspace so Toolbar (z-40) never covers its close header`,
      )
      assert.match(
        src,
        /\babsolute\s+inset-y-0\b/,
        `${name} must position mobile/tablet drawer with absolute inset-y-0`,
      )
      assert.match(
        src,
        /inert=\{/,
        `${name} must set inert when collapsed so hidden controls stay out of Tab focus order`,
      )
    }
  })

  it('contains zero dangerous DOM HTML sinks and zero ad-hoc keyCode === 229 IME checks outside utils/keyboard.ts', () => {
    const files = collectSourceFiles(srcDir)
    for (const file of files) {
      const rel = path.relative(srcDir, file)
      const src = fs.readFileSync(file, 'utf8')
      assert.doesNotMatch(
        src,
        /dangerouslySetInnerHTML|\.innerHTML\s*=/,
        `${rel} must not use dangerouslySetInnerHTML or innerHTML`,
      )
      if (rel !== path.join('utils', 'keyboard.ts')) {
        assert.doesNotMatch(
          src,
          /keyCode\s*===\s*229/,
          `${rel} should use isImeComposing(event) from utils/keyboard.ts`,
        )
      }
    }
  })
})
