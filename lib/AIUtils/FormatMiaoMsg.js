export function FormatMiaoMsg(msg) {
  const getCircularReplacer = () => {
    const seen = new WeakSet()
    return (key, value) => {
      if (['client', 'group', 'friend', 'member', 'bot'].includes(key)) {
        return undefined
      }
      // 处理 BigInt 类型，转换为字符串
      if (typeof value === 'bigint') {
        return value.toString()
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]'
        }
        seen.add(value)
      }
      return value
    }
  }
  return JSON.parse(JSON.stringify(msg, getCircularReplacer()))
}
