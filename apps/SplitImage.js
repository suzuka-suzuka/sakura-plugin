import plugin from "../../../lib/plugins/plugin.js"
import { getImg, makeForwardMsg } from "../lib/utils.js"
import sharp from "sharp"
import axios from "axios"

export class SplitImage extends plugin {
  constructor() {
    super({
      name: "图片切割",
      dsc: "将图片按指定行列切割并发送",
      event: "message",
      priority: 1135,
      rule: [
        {
          reg: "^切割\\s*(\\d+)\\s*(\\d+)$",
          fnc: "splitImage",
          log: false,
        },
      ],
    })
  }

  async splitImage(e) {
    const match = e.msg.match(/^切割\s*(\d+)\s*(\d+)$/)
    if (!match) return false

    const cols = parseInt(match[1])
    const rows = parseInt(match[2])

    if (cols <= 0 || rows <= 0) {
      return false
    }

    if (cols > 10 || rows > 10) {
      e.reply("切太多啦，建议行列数都在10以内")
      return true
    }

    const imgUrls = await getImg(e)
    if (!imgUrls || imgUrls.length === 0) {
      return false
    }

    const targetUrl = imgUrls[0]

    try {
      const response = await axios.get(targetUrl, { responseType: "arraybuffer" })
      const imageBuffer = Buffer.from(response.data)

      const image = sharp(imageBuffer)
      const metadata = await image.metadata()
      const width = metadata.width
      const height = metadata.height

      const pieceWidth = Math.floor(width / cols)
      const pieceHeight = Math.floor(height / rows)

      const msgList = []
      const botId = e.self_id || 2854196310
      const botName = e.bot?.nickname || "Bot"

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const left = c * pieceWidth
          const top = r * pieceHeight

          const pieceBuffer = await image
            .clone()
            .extract({
              left: left,
              top: top,
              width: pieceWidth,
              height: pieceHeight,
            })
            .toBuffer()

          msgList.push({
            text: segment.image(pieceBuffer),
            senderId: botId,
            senderName: botName,
          })
        }
      }

      await makeForwardMsg(e, msgList, `图片已切割为 ${cols}列 x ${rows}行`)
    } catch (err) {
      logger.error("[SplitImage] 切割图片失败", err)
    }
    return true
  }
}
