import { GoogleGenAI, Modality } from "@google/genai";
import { AbstractTool } from "./AbstractTool.js";

export class ImageGeneratorTool extends AbstractTool {
    name = 'ImageGenerator';

    parameters = {
        properties: {
            prompt: {
                type: 'string',
                description: '用于生成或修改图片的英文描述性文字，请将描述性文字翻译为英文',
            },
            imageUrl: {
                type: 'string',
                description: '图片的URL',
            },
            size: {
                type: 'string',
                description: '指定图片的宽高比。只支持 "1:1", "16:9", "9:16", "4:3", "3:4"'
            }
        },
        required: ['prompt']
    };

    description = '当你需要根据描述生成图片或者在提供一张图片的基础上生成新的内容时使用';

    func = async function (opts, e) {
        const IMAGEN_API_KEY = "AIzaSyD6ys6xTFZxnhfQ6YNXrU7WsR4EgmRYtCU";
        const GEMINI_API_KEY = "AIzaSyBJTT0KDn0_wPEJ2O6T8605968SIB9Qm_w";

        const IMAGEN_MODEL = 'imagen-4.0-generate-preview-06-06';
        const GEMINI_MODEL = 'gemini-2.0-flash-preview-image-generation';

        let { prompt, imageUrl, size } = opts;

        if (!prompt) {
            return "你必须提供一个用于生成图片的描述。";
        }

        if (!imageUrl) {            
            try {
                const ai = new GoogleGenAI({ apiKey: IMAGEN_API_KEY });
                
                const imagenConfig = {
                    numberOfImages: 1,
					personGeneration: "allow_all",
                };

                const validSizes = ["1:1", "16:9", "9:16", "4:3", "3:4"];
                if (size && validSizes.includes(size)) {
                    imagenConfig.aspectRatio = size;
                } 

                const response = await ai.models.generateImages({
                    model: IMAGEN_MODEL,
                    prompt: prompt,
                    config: imagenConfig,
                });

                if (response.generatedImages && response.generatedImages.length > 0) {
                    const imageData = response.generatedImages[0].image.imageBytes;
                    e.reply(segment.image(`base64://${imageData}`)); 
                    return `已成功生成并发送图片。`;
                } else {
                    return "Imagen 模型返回了响应，但未能获取到图片数据。";
                }

            } catch (error) {
                console.error("Imagen 图片生成失败:", error);
                return `图片生成失败，错误信息: ${error.message}`;
            }
        }
        else {
            try {
                const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
                const contents = [];
                contents.push({ text: prompt });

                const imageResponse = await fetch(imageUrl);
                if (!imageResponse.ok) {
                    return `无法访问提供的图片URL，状态码: ${imageResponse.status}`;
                }

                const contentType = imageResponse.headers.get('content-type');
                if (!contentType || !contentType.startsWith('image/')) {
                    return `提供的URL内容不是有效的图片格式。 Content-Type: ${contentType}`;
                }
                
                const arrayBuffer = await imageResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Image = buffer.toString('base64');

                contents.push({
                    inlineData: {
                        mimeType: contentType,
                        data: base64Image,
                    },
                });

                const response = await ai.models.generateContent({
                    model: GEMINI_MODEL,
                    contents: contents,
                    config: {
                        responseModalities: [Modality.TEXT, Modality.IMAGE],
                    },
                });

                const imagePart = response.candidates?.[0]?.content?.parts?.find(
                    part => part.inlineData && part.inlineData.mimeType.startsWith('image/')
                );

                if (imagePart) {
                    const imageData = imagePart.inlineData.data;
                    e.reply(segment.image(`base64://${imageData}`)); 
                    return `已成功生成并发送图片。`;
                } else {
                    return "Gemini 返回了内容，但未能从中获取到图片。";
                }
            } catch (error) {
                console.error("Gemini 图片生成失败:", error);
                if (error.message && error.message.includes("Could not load image")) {
                    return `图片生成失败，可能是由于提供的图片无法访问或格式不受支持。请检查图片URL或尝试其他图片。错误信息: ${error.message}`;
                }
                return `图片生成失败，错误信息: ${error.message}`;
            }
        }
    };
}
