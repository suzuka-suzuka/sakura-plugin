import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { AbstractTool } from './AbstractTool.js';
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import { plugindata } from '../../path.js';
import Setting from '../../setting.js'; 
export class VideoAnalyzerTool extends AbstractTool {
    name = 'videoAnalyzer';

    parameters = {
        properties: {
            file: {
                type: 'STRING',
                description: '视频file字段'
            },
            query: {
                type: 'STRING',
                description: '你希望对视频提出的问题，用中文描述。'
            }
        },
        required: ['file', 'query']
    };
    description = '当你需要分析或描述视频时使用';

    func = async function (opts, e) {
        const API_KEY = 'AIzaSyBJTT0KDn0_wPEJ2O6T8605968SIB9Qm_w'
        const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20'
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const { file, query } = opts;

        if (!file || !query) {
            return '错误：视频的file标识 (file) 和 查询文本 (query) 不能为空。';
        }

        let tempPath = '';

        try {
            const videoDir = path.join(plugindata, 'video');
            if (!fs.existsSync(videoDir)) {
                fs.mkdirSync(videoDir, { recursive: true });
            }

            const fileResult = await e.bot.getFile(file);
            if (!fileResult || (!fileResult.url && !fileResult.base64)) {
                return "抱歉，无法从服务器获取视频文件数据(url/base64)，请稍后重试。";
            }

            tempPath = path.join(videoDir, `video_${Date.now()}.mp4`);

            if (fileResult.url) {
                const response = await axios.get(fileResult.url, { responseType: 'arraybuffer' });
                fs.writeFileSync(tempPath, response.data);
            } else {
                const videoBuffer = Buffer.from(fileResult.base64, 'base64');
                fs.writeFileSync(tempPath, videoBuffer);
            }

            if (!fs.existsSync(tempPath)) {
                return `错误：未能成功创建临时文件: ${tempPath}`;
            }

            const myfile = await ai.files.upload({
                file: tempPath,
                config: { mimeType: 'video/mp4' },
            });

            await new Promise(resolve => setTimeout(resolve, 10000));

            const aiResponse = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: createUserContent([
                    createPartFromUri(myfile.uri, myfile.mimeType),
                    query,
                ]),
            });

            const description = aiResponse.text;
            return description ? `视频AI描述:\n${description}` : '未能获取视频AI描述。';

        } catch (error) {
            logger.error(`[VideoAnalyzerTool] Error: ${error.stack}`);
            return `处理视频时发生错误: ${error.message}`;
        } finally {
            if (tempPath && fs.existsSync(tempPath)) {
                try {
                    fs.unlinkSync(tempPath);
                } catch (cleanupError) {
                    logger.error(`[VideoAnalyzerTool] 删除临时文件时出错: ${cleanupError.message}`);
                }
            }
        }
    };
}