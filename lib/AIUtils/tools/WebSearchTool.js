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

    const safeQuery = query.trim()

    // 搜索可视化：仅提示“正在搜索”，不发送搜索结果
    if (e?.sendForwardMsg) {
      try {
        const botId = e.self_id
        const actionNews = `正在搜索 ${safeQuery}`
        const nodes = [
          {
            user_id: botId,
            nickname: "🔎 搜索工具",
            content: [{ type: "text", data: { text: actionNews } }],
          },
        ]
        await e.sendForwardMsg(nodes, {
          source: "工具执行",
          prompt: actionNews,
          news: [{ text: actionNews }],
        })
      } catch {
        // 可视化发送失败不影响主流程
      }
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
        [{ text: safeQuery }],
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
