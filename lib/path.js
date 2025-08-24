import path from 'path'

const _path = process.cwd().replace(/\\/g, '/')


const pluginName = path.basename(path.join(import.meta.url, '../../'))

const pluginRoot = path.join(_path, 'plugins', pluginName)

const pluginresources = path.join(pluginRoot, 'resources')

const plugindata = path.join(pluginRoot, 'data')

export {
  _path,
  pluginName,
  pluginRoot,
  plugindata,
  pluginresources
}