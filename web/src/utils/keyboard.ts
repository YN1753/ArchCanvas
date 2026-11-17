/**
 * 检测键盘事件是否处于中文/日文等输入法（IME）组合输入状态。
 * 兼容标准 `isComposing` 与部分浏览器的 `keyCode === 229` 兜底。
 */
export function isImeComposing(event: {
  nativeEvent?: { isComposing?: boolean }
  isComposing?: boolean
  keyCode?: number
}): boolean {
  return Boolean(event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229)
}
