import { AbstractTool } from "./AbstractTool.js";

export class SendMusicTool extends AbstractTool {
  name = "sendMusic";

  parameters = {
    properties: {
      id: {
        type: "string",
        description: "音乐的id",
      },
    },
    required: ["id"],
  };
  description =
    "当你想要分享音乐时使用。你必须先使用searchMusic工具来获取音乐ID。";

  func = async function (opts, e) {
    let { id } = opts;

    try {
      const res = await e.reply(segment.music("163", id));
      if (!res || !res.message_id) return `音乐发送失败，可能是版权问题`;

      return `音乐已经发送`;
    } catch (err) {
      logger.error("发送音乐失败:", err);
      return `音乐发送失败: ${err}`;
    }
  };
}
