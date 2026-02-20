
import { generateImage } from "../nai/naiApi.js"

export async function checkForNaiTags(message, e, naiPrompt) {
    if (!message) return message;

    const drawTagRegex = /<draw>([\s\S]*?)<\/draw>/gi;



    let hasMatch = false;
    const tasks = [];

    let cleanedMessage = message.replace(drawTagRegex, (match, content) => {
        hasMatch = true;
        tasks.push(async () => {
            try {
                let global = content.replace(/[\r\n]+/g, ',').trim();

                if (naiPrompt) {
                    if (global) {
                        global += `, ${naiPrompt}`;
                    } else {
                        global = naiPrompt;
                    }
                }

                logger.info(`绘图提示词: ${global}`);
                const imageBuffer = await generateImage(global, null, null, { width: 1216, height: 832 }, null, []);
                const base64Image = imageBuffer.toString('base64');
                e.reply(segment.image(`base64://${base64Image}`));

            } catch (error) {
                logger.error(`绘图失败: ${error.message}`);
            }
        });
        return "";
    });



    if (hasMatch) {
        for (const task of tasks) {
            task().catch(err => logger.error(`绘图失败: ${err}`));
        }
    }

    return cleanedMessage.trim();
}


