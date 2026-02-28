import {
    generateImageWithCallback,
    getQueueLength,
    getIsProcessing,
} from "../lib/nai/naiApi.js";
import { getImg } from "../lib/utils.js";
import { saveVibe, getVibe, deleteVibe as removeVibe, listVibes as getAllVibes } from "../lib/nai/vibeStore.js";
import Setting from "../lib/setting.js";

export class NaiPainting extends plugin {
    constructor() {
        super({
            name: "NovelAI绘画",
            event: "message",
            priority: 1135,
        });
    }

    addVibe = Command(/^#?添加画风\s*(.+)$/, "master", async (e) => {
        const name = e.msg.replace(/^#?添加画风\s*/, "").trim();
        if (!name) {
            return false;
        }

        let imageBase64 = null;
        try {
            const images = await getImg(e, false, true);
            if (images && images.length > 0) {
                imageBase64 = images[0].base64;
            }
        } catch (err) {
            logger.error(`[NaiPainting] Failed to get vibe image: ${err.message}`);
        }

        if (!imageBase64) {
            return false;
        }

        try {
            saveVibe(name, imageBase64);
            await e.reply(`画风「${name}」已保存成功！`, 10);
        } catch (err) {
            logger.error(`[NaiPainting] Failed to save vibe: ${err.message}`);
            await e.reply(`保存画风失败: ${err.message}`, 10, true);
        }
        return true;
    });

    deleteVibe = Command(/^#?删除画风\s*(.+)$/, "master", async (e) => {
        const name = e.msg.replace(/^#?删除画风\s*/, "").trim();
        if (!name) {
            return false;
        }

        if (removeVibe(name)) {
            await e.reply(`画风「${name}」已删除`, 10);
        } else {
            await e.reply(`画风「${name}」不存在`, 10, true);
        }
        return true;
    });

    listVibes = Command(/^#?画风列表$/, async (e) => {
        const vibes = getAllVibes();
        if (vibes.length === 0) {
            return false;
        }

        const list = vibes
            .map((v, i) => `${i + 1}. ${v.name} (强度: ${v.strength}, 提取: ${v.informationExtracted})`)
            .join("\n");
        await e.sendForwardMsg(`已保存的画风：\n${list}\n\n使用方式：绘图 画风名`, {
            source: "画风列表",
            news: [{ text: `共 ${vibes.length} 个画风` }],
        });
        return true;
    });

    naiParams = Command(/^#?绘图\s*(.*)$/, async (e) => {
        let rawMsg = e.msg.replace(/^#?绘图\s*/, "").trim();

        // 尝试匹配画风名称
        let vibeData = null;
        const allVibes = getAllVibes();
        // 按名称长度降序排列，优先匹配最长的名称
        const sortedVibes = allVibes.sort((a, b) => b.name.length - a.name.length);
        for (const v of sortedVibes) {
            if (rawMsg.startsWith(v.name)) {
                vibeData = getVibe(v.name);
                rawMsg = rawMsg.substring(v.name.length).trim();
                break;
            }
        }

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

        if (!prompt && characters.length === 0 && !vibeData) {
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

        // 构建 vibe transfer 参数
        const vibeParams = {};
        if (vibeData) {
            vibeParams.reference_image_multiple = [vibeData.image];
            vibeParams.reference_information_extracted_multiple = [vibeData.informationExtracted];
            vibeParams.reference_strength_multiple = [vibeData.strength];
        }

        try {
            const onStart = async (remaining) => {
                const vibeHint = vibeData ? `（画风: ${vibeData.name}）` : "";
                await e.reply(`开始绘制${vibeHint}，当前队列剩余: ${remaining}`, 10, true);
            };
            const imageBuffer = await generateImageWithCallback(
                prompt,
                null,
                null,
                { width, height, ...vibeParams },
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
