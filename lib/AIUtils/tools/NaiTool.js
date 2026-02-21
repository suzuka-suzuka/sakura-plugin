import { AbstractTool } from "./AbstractTool.js";
import { generateImage } from "../../nai/naiApi.js";

export class NaiTool extends AbstractTool {
    name = "NaiPainting";
    description = "用于画画、绘图、生成二次元/动漫风格图片";

    parameters = {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "图片生成提示词，使用符合NAI生图的英文标签和少量的自然语言",
            },
        },
        required: ["prompt"],
    };

    func = async function (opts, e) {
        const { prompt } = opts;

        if (!prompt) {
            return "请提供一个图片生成提示词。";
        }

        try {
            const imageBuffer = await generateImage(prompt, null, null, {});
            const base64Image = imageBuffer.toString("base64");
            await e.reply(segment.image(`base64://${base64Image}`));

            return "已成功生成并发送图片，禁止回复[图片]";
        } catch (error) {
            logger.error(`[NaiTool] Error: ${error.message}`);
            return `图片生成失败：${error.message}`;
        }
    };
}
