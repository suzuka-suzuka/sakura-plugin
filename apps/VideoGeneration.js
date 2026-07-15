import fs from "node:fs/promises";
import { formatMediaUserError } from "../lib/AIUtils/mediaErrorMessages.js";
import { parseVideoCommandArgs } from "../lib/AIUtils/videoCommandParser.js";
import { generateVideoWithProvider } from "../lib/AIUtils/videoProvider.js";
import { getImg } from "../lib/utils.js";

const VIDEO_COMMAND_PATTERN = /^#v(?![a-z])\s*(.*)$/i;

async function replyVideoSource(e, result) {
  if (/^https?:\/\//i.test(result.source) || /^data:video\//i.test(result.source)) {
    await e.reply(
      `${result.provider === "gemini" ? "Gemini Omni" : "Grok"} 视频生成好了，但本地下载失败，先给你原始链接：${result.source}`
    );
    return;
  }

  await e.reply(segment.video(result.source));
  fs.unlink(result.source).catch(() => {});
}

async function replyParameterWarnings(e, warnings) {
  await e.reply(
    `参数提示：${warnings.join("；")}。已按兼容参数继续生成`,10
  );
}

export class VideoGeneration extends plugin {
  constructor() {
    super({
      name: "AI Video",
      event: "message",
      priority: 1000,
    });
  }

  generateVideo = Command(VIDEO_COMMAND_PATTERN, async (e) => {
    const match = e.msg.match(VIDEO_COMMAND_PATTERN);
    if (!match) return false;

    try {
      const { channel, prompt, options } = parseVideoCommandArgs(match[1]);
      const imageRefs = (await getImg(e, true, true)) || [];
      if (!prompt && imageRefs.length === 0) return false;

      await e.react(124);
      const result = await generateVideoWithProvider({
        channel,
        prompt,
        images: imageRefs,
        options,
        onParameterWarnings: (warnings) =>
          replyParameterWarnings(e, warnings),
      });
      await replyVideoSource(e, result);
      return true;
    } catch (error) {
      logger.error("[VideoGeneration] video request failed", error);
      await e.reply(
        `视频生成失败：${formatMediaUserError(error, { kind: "video" })}`,
        10,
        true
      );
    }

    return true;
  });
}
