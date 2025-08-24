import { AbstractTool } from './AbstractTool.js';
import { GoogleGenAI } from "@google/genai";
import Setting from '../../setting.js'; 

export class WebSearchTool extends AbstractTool {
    name = 'Search';
    description;
    parameters = {
        properties: {
            query: {
                type: 'string',
                description: '用于搜索的问题或关键词'
            },
        },
        required: ['query'],
    };

     constructor() {
        super();       
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0'); 
        const day = String(today.getDate()).padStart(2, '0');
        this.description = `当你需要搜索或回答需要外部数据的问题时可以使用此工具。今天是 ${year}年${month}月${day}日`;
    }

    func = async function (opts, e) {
        const API_KEY = 'AIzaSyBJTT0KDn0_wPEJ2O6T8605968SIB9Qm_w'
        const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20'
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        let { query } = opts;

        if (!query || query.trim() === '') {
            return '你必须提供一个搜索查询。';
        }

        try {
            const groundingTool = { googleSearch: {} };
            const config = {
                tools: [groundingTool],
                }
            

            const internalGeminiResponse = await ai.models.generateContent({
                model: GEMINI_MODEL, 
                contents: [{ role: "user", parts: [{ text: query }] }],
                config,
            });

            const searchResultText = internalGeminiResponse.text;

            return `${searchResultText}`;

        } catch (error) {
            return `执行 Google Search 工具时发生意外错误：${error.message}`;
        }
    };
}