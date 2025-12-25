import { AbstractTool } from "./AbstractTool.js"
import Setting from "../../setting.js"
import { getAI } from "../getAI.js"

export class WebSearchTool extends AbstractTool {
  name = "Search"
  description = "当你需要搜索或回答需要外部数据的问题时可以使用此工具"
  parameters = {
    properties: {
      query: {
        type: "string",
        description: "用于搜索的问题或关键词",
      },
    },
    required: ["query"],
  }

  func = async function (opts, e) {
    const { query } = opts
    if (!query || query.trim() === "") {
      return "你必须提供一个搜索查询。"
    }

    const aiConfig = Setting.getConfig("AI")
    const toolsChannel = aiConfig.toolschannel

    if (!toolsChannel) {
      return "配置错误：未设置 toolschannel。"
    }

    try {
      const result = await getAI(
        toolsChannel,
        e,
        [{ text: query }],
        null,
        false,
        false,
        [],
      )

      if (typeof result === "string") {
        return result
      }

      return result.text
    } catch (error) {
      return `搜索工具执行出错: ${error.message}`
    }
  }
}
