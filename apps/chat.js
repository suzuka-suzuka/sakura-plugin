import Setting from "../lib/setting.js";
import { getAI } from '../lib/AIUtils/getAI.js';
import { loadConversationHistory, saveConversationHistory } from '../lib/AIUtils/ConversationHistory.js';
import { executeToolCalls } from '../lib/AIUtils/tools/tools.js';
import { parseAtMessage } from '../lib/AIUtils/messaging.js';
import { getImg } from '../lib/utils.js';

export class AIChat extends plugin {
    constructor() {
        super({
            name: 'chat',
            dsc: ' AI 聊天插件',
            event: 'message',
            priority: 1135,
            rule: [
                {
                    reg: '',
                    fnc: 'Chat',
                    log: false
                }
            ]
        });
    }

    get appconfig() {
        return Setting.getConfig("AI");
    }

    async Chat(e) {
        const config = this.appconfig;
        if (!config || !config.profiles || config.profiles.length === 0) {
            return false;
        }

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
        let messageText = contentParts.join('').trim();
        if (!messageText) {
            return false;
        }

        const matchedProfile = config.profiles.find(p => messageText.startsWith(p.prefix));

        if (!matchedProfile) {
            return false;
        }

        const { prefix, Channel, Prompt, GroupContext, History, Tool } = matchedProfile;

        let query = messageText.substring(prefix.length).trim();

        const imageUrls = await getImg(e);
        if ((!query) && (!imageUrls || imageUrls.length === 0)) {
            return false;
        }

        if (imageUrls && imageUrls.length > 0) {
            for (const url of imageUrls) {
                query += ` [图片: ${url}]`;
            }
            query = query.trim();
        }

        logger.info(`Chat触发`);
        let finalResponseText = '';
        let currentFullHistory = [];
        let toolCallCount = 0; 

        try {
            if (History) {
                currentFullHistory = await loadConversationHistory(e, prefix);
            }

            const queryParts = [{ text: query }];

            let currentAIResponse = await getAI(
                Channel,
                e,
                queryParts,
                Prompt,
                GroupContext,
                Tool,
                currentFullHistory
            );

            if (typeof currentAIResponse === 'string') {
                await this.reply(currentAIResponse, false, { recallMsg: 10 });
                return true;
            }

            currentFullHistory.push({ role: "user", parts: queryParts });

            while (true) {
                const textContent = currentAIResponse.text;
                const functionCalls = currentAIResponse.functionCalls;
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
                    if (toolCallCount >= 5) {
                        logger.warn(`[Chat] 工具调用次数超过上限，强行结束对话`);
                        return true;
                    }

                    if (textContent) {
                        const cleanedTextContent = textContent.replace(/\n+$/, '');
                        const parsedcleanedTextContent = parseAtMessage(cleanedTextContent);
                        await this.reply(parsedcleanedTextContent, true);
                    }
                    const executedResults = await executeToolCalls(e, functionCalls);
                    currentFullHistory.push(...executedResults);

                    currentAIResponse = await getAI(
                        Channel,
                        e,
                        '',
                        Prompt,
                        GroupContext,
                        Tool, 
                        currentFullHistory
                    );

                    if (typeof currentAIResponse === 'string') {
                        await this.reply(currentAIResponse, false, { recallMsg: 10 });
                        return true;
                    }

                } else if (textContent) {
                    finalResponseText = textContent;
                    break;
                }
            }

            if (History) {
                const historyToSave = currentFullHistory.filter(part =>
                    part.role === "user" || (part.role === "model" && part.parts.every(p => p.hasOwnProperty('text')))
                );
                await saveConversationHistory(e, historyToSave, prefix);
            }
            
            const msg = parseAtMessage(finalResponseText)
            await this.reply(msg);
            
        } catch (error) {
            logger.error(`Chat处理过程中出现错误: ${error.message}`);
            await this.reply(`处理过程中出现错误: ${error.message}`, false, { recallMsg: 10 });
            return true;
        }
        return true;
    }
}