import {
    generateImageWithCallback,
    getQueueLength,
    getIsProcessing,
} from "../lib/nai/naiApi.js";
import { getImg } from "../lib/utils.js";
import { Setting } from "../setting.js";

export class NaiPainting extends plugin {
    constructor() {
        super({
            name: "NovelAI绘画",
            event: "message",
            priority: 5000,
        });
    }

    naiParams = Command(/^绘图\s*(.*)$/, async (e) => {
        let rawMsg = e.msg.replace(/^绘图\s*/, "").trim();

        const characters = [];
        let prompt = rawMsg
            .replace(/\[(.*?)\]/g, (match, content) => {
                let text = content.trim();
                let center = { x: 0.5, y: 0.5 };

                const positionMap = {
                    左上: { x: 0.3, y: 0.3 },
                    右上: { x: 0.7, y: 0.3 },
                    左下: { x: 0.3, y: 0.7 },
                    右下: { x: 0.7, y: 0.7 },
                    中间: { x: 0.5, y: 0.5 },
                    中心: { x: 0.5, y: 0.5 },
                    左: { x: 0.3, y: 0.5 },
                    右: { x: 0.7, y: 0.5 },
                    上: { x: 0.5, y: 0.3 },
                    下: { x: 0.5, y: 0.7 },
                    中: { x: 0.5, y: 0.5 },
                };

                for (const [key, pos] of Object.entries(positionMap)) {
                    if (text.startsWith(key)) {
                        center = pos;
                        text = text
                            .substring(key.length)
                            .replace(/^[,:\s]+/, "")
                            .trim();
                        break;
                    }
                }

                if (text) {
                    characters.push({
                        prompt: text,
                        uc: "",
                        center: center,
                        enabled: true,
                    });
                }
                return "";
            })
            .trim();

        let width = 832;
        let height = 1216;

        if (prompt.includes("横")) {
            width = 1216;
            height = 832;
            prompt = prompt.replace(/横/g, "");
        } else if (prompt.includes("方")) {
            width = 1024;
            height = 1024;
            prompt = prompt.replace(/方/g, "");
        } else if (prompt.includes("竖")) {
            width = 832;
            height = 1216;
            prompt = prompt.replace(/竖/g, "");
        }

        prompt = prompt.replace(/\s+/g, " ").replace(/^,+|,+$/g, "");

        if (!prompt && characters.length === 0) {
            return false;
        }

        let imageBase64 = null;
        try {
            const images = await getImg(e, true, true);
            if (images && images.length > 0) {
                imageBase64 = images[0].base64;
            }
        } catch (err) {
            logger.error(`[NaiPainting] Failed to get image: ${err.message}`);
        }
        if (!e.isWhite && !Setting.payForCommand(e, "绘图")) return false;
        const currentQueueLength = getQueueLength();
        if (getIsProcessing()) {
            await e.reply(
                `已加入绘图队列，前方排队: ${currentQueueLength + 1} 人`,
                10,
            );
        }

        try {
            const onStart = async (remaining) => {
                await e.reply(`开始绘制，当前队列剩余: ${remaining}`, 10, true);
            };
            const imageBuffer = await generateImageWithCallback(
                prompt,
                null,
                null,
                { width, height },
                imageBase64,
                characters,
                onStart,
            );
            const base64Image = imageBuffer.toString("base64");
            await e.reply(segment.image(`base64://${base64Image}`));
        } catch (error) {
            logger.error(`[NaiPainting] Error: ${error.message}`);
            await e.reply(`绘图失败: ${error.message}`, 10, true);
        }

        return true;
    });
}
