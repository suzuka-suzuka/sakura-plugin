import AdmZip from 'adm-zip'
import Setting from '../setting.js'

export async function generateImage(prompt, model = null, negative = null, parameters = {}, image = null, characters = []) {
    prompt = prompt + ",very aesthetic, masterpiece, no text"
    const config = Setting.getConfig('nai')
    if (!config || !config.token) {
        throw new Error('请先在配置中设置 NovelAI Token')
    }

    const useModel = model || config.model || "nai-diffusion-4-5-full"
    const useNegative = negative || config.negative || "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"

    const characterPrompts = characters.map(char => ({
        prompt: char.prompt,
        uc: char.uc || "",
        center: char.center || { x: 0.5, y: 0.5 },
        enabled: char.enabled !== false
    }))

    const v4CharCaptions = characters.map(char => ({
        char_caption: char.prompt,
        centers: [char.center || { x: 0.5, y: 0.5 }]
    }))

    const v4NegativeCharCaptions = characters.map(char => ({
        char_caption: char.uc || "",
        centers: [char.center || { x: 0.5, y: 0.5 }]
    }))

    const payload = {
        "input": prompt,
        "model": useModel,
        "action": image ? "img2img" : "generate",
        "parameters": {
            "params_version": 3,
            "width": 832,
            "height": 1216,
            "scale": 5,
            "sampler": "k_euler_ancestral",
            "steps": 28,
            "seed": Math.floor(Math.random() * 4294967296),
            "n_samples": 1,
            "autoSmea": false,
            "dynamic_thresholding": false,
            "controlnet_strength": 1,
            "legacy": false,
            "add_original_image": true,
            "cfg_rescale": 0,
            "noise_schedule": "karras",
            "legacy_v3_extend": false,
            "skip_cfg_above_sigma": 58,
            "use_coords": false,
            "legacy_uc": false,
            "normalize_reference_strength_multiple": true,
            "inpaintImg2ImgStrength": 1,
            "characterPrompts": characterPrompts,
            "v4_prompt": {
                "caption": {
                    "base_caption": prompt,
                    "char_captions": v4CharCaptions
                },
                "use_coords": false,
                "use_order": true
            },
            "v4_negative_prompt": {
                "caption": {
                    "base_caption": useNegative,
                    "char_captions": v4NegativeCharCaptions
                },
                "legacy_uc": false
            },
            "negative_prompt": useNegative,
            "deliberate_euler_ancestral_bug": false,
            "prefer_brownian": true,
            "image_format": "png",
            ...parameters
        },
    }

    if (image) {
        payload.parameters.image = image
        payload.parameters.strength = parameters.strength || 0.7
        payload.parameters.noise = parameters.noise || 0
    }

    const response = await fetch('https://image.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.token}`
        },
        body: JSON.stringify(payload)
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API Request failed with status ${response.status}: ${errorText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const zip = new AdmZip(buffer)
    const zipEntries = zip.getEntries()

    if (zipEntries.length > 0) {
        const imageEntry = zipEntries[0]
        return imageEntry.getData()
    } else {
        throw new Error('生成失败，未收到图片数据')
    }
}
