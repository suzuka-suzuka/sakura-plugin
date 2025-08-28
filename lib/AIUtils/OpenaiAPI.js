import OpenAI from "openai";
import { buildGroupPrompt } from './GroupContext.js';
import { ToolsSchema } from './tools/tools.js';
import Setting from '../setting.js';

export async function getDeepSeekResponse(
    e,
    queryParts,
    presetPrompt,
    enableGroupContext,
    enableTools,
    historyContents = []
) {
    const config = Setting.getConfig('AI');
    const { DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL, groupContextLength } = config;

    if (!DEEPSEEK_API_KEY) {
        logger.error("DeepSeek API key is not configured.");
        return false;
    }

    const deepseek = new OpenAI({
        baseURL: DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        apiKey: DEEPSEEK_API_KEY,
    });

    let messages = [];
    let fullSystemInstructionText = "";

    try {
        if (presetPrompt && presetPrompt.trim()) {
            fullSystemInstructionText += presetPrompt.trim();
        }

        const systemPromptWithContext = await buildGroupPrompt(
            e,
            enableGroupContext,
            groupContextLength
        );

        if (systemPromptWithContext.trim()) {
            if (fullSystemInstructionText) {
                fullSystemInstructionText += "\n\n";
            }
            fullSystemInstructionText += systemPromptWithContext.trim();
        }

        if (fullSystemInstructionText.trim()) {
            messages.push({ role: "system", content: fullSystemInstructionText.trim() });
        }

        if (historyContents.length > 0) {
            const formattedHistory = historyContents.map(msg => {
                const role = msg.role === 'model' ? 'assistant' : msg.role;
                const content = msg.parts.map(part => part.text || '').join('');
                return { role, content };
            });
            messages.push(...formattedHistory);
        }

        if (queryParts && queryParts.length > 0) {
            const userQueryContent = queryParts.map(part => part.text || '').join('');
            if (userQueryContent) {
                messages.push({
                    role: "user",
                    content: userQueryContent
                });
            }
        }

        if (messages.length === 0 || (messages.length === 1 && messages[0].role === 'system')) {
            logger.warn(`No query or history content available to send to DeepSeek.`);
            return false;
        }

        const requestOptions = {
            model: DEEPSEEK_MODEL || "deepseek-chat",
            messages: messages,
        };

        if (enableTools && ToolsSchema && ToolsSchema.length > 0) {
            requestOptions.tools = ToolsSchema.map(func => ({ type: "function", function: func }));
            requestOptions.tool_choice = "auto";
        }

        const completion = await deepseek.chat.completions.create(requestOptions);

        if (!completion || !completion.choices || completion.choices.length === 0) {
            logger.warn(`DeepSeek did not return a valid response or candidates.`, JSON.stringify(completion, null, 2));
            return false;
        }

        const choice = completion.choices[0];
        const message = choice.message;
        
        let extractedText = message.content || "";
        let extractedFunctionCalls = [];

        if (message.tool_calls && message.tool_calls.length > 0) {
            extractedFunctionCalls = message.tool_calls.map(toolCall => {
                try {
                    return {
                        name: toolCall.function.name,
                        args: JSON.parse(toolCall.function.arguments),
                    };
                } catch (parseError) {
                    logger.error(`Failed to parse function call arguments for ${toolCall.function.name}:`, parseError);
                    return null;
                }
            }).filter(call => call !== null);
        }
        
        if (choice.finish_reason === 'tool_calls' && extractedFunctionCalls.length === 0) {
             logger.warn(`DeepSeek indicated tool calls, but none were extracted.`);
        }

        if (!extractedText && extractedFunctionCalls.length === 0) {
            logger.warn(`DeepSeek returned an empty message content.`);
            return false;
        }
        
        return { text: extractedText, functionCalls: extractedFunctionCalls };

    } catch (error) {
        logger.error(`DeepSeek API call failed: ${error.message}`);
        if (error.response) {
            logger.error('Error Response:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}
