import path from "path"
import { fileURLToPath } from "url"

const projectRoot = process.cwd()
const _path = projectRoot.replace(/\\/g, "/")

const runtimeFilePath = fileURLToPath(import.meta.url)
const runtimeLibDir = path.dirname(runtimeFilePath)
const runtimePluginRoot = path.resolve(runtimeLibDir, "..")

const pluginName = path.basename(runtimePluginRoot)
const originalPluginRoot = path.join(projectRoot, "plugins", pluginName)

const useOriginalPluginRoot = process.env.NODE_ENV === "production"
const pluginRoot = useOriginalPluginRoot ? originalPluginRoot : runtimePluginRoot

const plugindata = path.join(pluginRoot, "data")
const pluginresources = path.join(pluginRoot, "resources")
const configRoot = path.join(projectRoot, "config")
const pluginConfigDir = path.join(configRoot, pluginName)
const logRoot = path.join(projectRoot, "logs")

export {
  _path,
  projectRoot,
  pluginName,
  pluginRoot,
  originalPluginRoot,
  runtimePluginRoot,
  useOriginalPluginRoot,
  plugindata,
  pluginresources,
  configRoot,
  pluginConfigDir,
  logRoot,
}
