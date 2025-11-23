export function FormatMiaoMsg(msg) {
  const getCircularReplacer = () => {
    const seen = new WeakSet()
    return (key, value) => {
      if (['client', 'group', 'friend', 'member', 'bot'].includes(key)) {
        return undefined
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
