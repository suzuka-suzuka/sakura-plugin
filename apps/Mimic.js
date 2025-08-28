import { getAI } from '../lib/AIUtils/getAI.js';
import { executeToolCalls } from '../lib/AIUtils/tools/tools.js';
import { splitAndReplyMessages, parseAtMessage } from '../lib/AIUtils/messaging.js';
import { getImg } from '../lib/utils.js';
import Setting from "../lib/setting.js";

export class Mimic extends plugin {
    constructor() {
        super({
            name: 'Mimic',
            dsc: 'Mimic',
            event: 'message',
            priority: Infinity,
            rule: [
                {
                    reg: '',
                    fnc: 'Mimic',
                    log: false
                }
            ]
        });
    }

    get appconfig() {
        return Setting.getConfig("mimic");
    }

    async Mimic(e) {
        let contentParts = [];
        if (e.message && Array.isArray(e.message) && e.message.length > 0) {
            e.message.forEach(msgPart => {
                switch (msgPart.type) {
                    case 'text':
                        contentParts.push(msgPart.text);
                        break;
                    case 'at':
                        contentParts.push(`@${msgPart.qq}`);
                        break;
                }
            });
        }
        const messageText = contentParts.join('').trim();

        let query = messageText;

        const imageUrls = await getImg(e);
        if (imageUrls && imageUrls.length > 0) {
            for (const url of imageUrls) {
                query += `[图片: ${url}]`;
            }
        }

        if (!query.trim()) {
            return false;
        }
        const mustReply = this.appconfig.triggerWords.some(word => messageText.includes(word));

        if (!mustReply && Math.random() > this.appconfig.replyProbability) {
            return false;
        }

        let selectedPresetPrompt = this.appconfig.Prompt;
        let shouldRecall = false;
        if (!e.isMaster && Math.random() < this.appconfig.alternatePromptProbability) {
            selectedPresetPrompt = this.appconfig.alternatePrompt;
            shouldRecall = true;
        }
        logger.info(`mimic触发`);
        let finalResponseText = '';
        let currentFullHistory = [];
        let toolCallCount = 0;
        const Channel = this.appconfig.Channel
        try {
            const queryParts = [{ text: query }];

            const geminiInitialResponse = await getAI(
                Channel,
                e,
                queryParts,
                selectedPresetPrompt,
                true,
                true,
                currentFullHistory
            );

            if (typeof geminiInitialResponse === 'string') {
                return false;
            }

            currentFullHistory.push({ role: "user", parts: queryParts });

            let currentGeminiResponse = geminiInitialResponse;

            while (true) {
                const textContent = currentGeminiResponse.text;
                const functionCalls = currentGeminiResponse.functionCalls;
                let modelResponseParts = [];

                if (textContent) {
                    modelResponseParts.push({ text: textContent });
                }
                if (functionCalls && functionCalls.length > 0) {
                    for (const fc of functionCalls) {
                        modelResponseParts.push({ functionCall: fc });
                    }
                }

                if (modelResponseParts.length > 0) {
                    currentFullHistory.push({ role: "model", parts: modelResponseParts });
                }

                if (functionCalls && functionCalls.length > 0) {
                    toolCallCount++; 
                    if (textContent) {
                        const cleanedTextContent = textContent.replace(/\n+$/, '');
                        const parsedcleanedTextContent = parseAtMessage(cleanedTextContent)
                        await e.reply(parsedcleanedTextContent, true)
                    }
                    const executedResults = await executeToolCalls(e, functionCalls);
                    currentFullHistory.push(...executedResults);
                    currentGeminiResponse = await getAI(
                        Channel,
                        e,
                        '',
                        selectedPresetPrompt,
                        true,
                        toolCallCount >= 5 ? false : true, 
                        currentFullHistory
                    );

                    if (typeof currentGeminiResponse === 'string') {
                        return false;
                    }

                } else if (textContent) {
                    finalResponseText = textContent;
                    break;
                }
            }

            await splitAndReplyMessages(e, finalResponseText, shouldRecall);

        } catch (error) {
            logger.error(`处理过程中出现错误: ${error.message}`);
            return false;
        }
        return false;
    }
}
