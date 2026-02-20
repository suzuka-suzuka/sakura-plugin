import { AbstractTool } from "./AbstractTool.js";
import { generateImage } from "../../nai/naiApi.js";

export class NaiTool extends AbstractTool {
    name = "NaiPainting";
    description = "Use NovelAI to generate images based on prompts. When users ask to draw something with NAI or NovelAI, use this tool.";

    parameters = {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "The prompt for the image generation. Should be in English, describing the desired image content.",
            },
        },
        required: ["prompt"],
    };

    func = async function (opts, e) {
        const { prompt } = opts;

        if (!prompt) {
            return "Please provide a prompt for the image.";
        }

        try {
            const imageBuffer = await generateImage(prompt, null, null, {});
            const base64Image = imageBuffer.toString("base64");
            await e.reply(segment.image(`base64://${base64Image}`));

            return "Image generated and sent successfully.";
        } catch (error) {
            logger.error(`[NaiTool] Error: ${error.message}`);
            return `Failed to generate image: ${error.message}`;
        }
    };
}
