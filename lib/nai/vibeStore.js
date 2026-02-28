import fs from "fs";
import path from "path";
import { plugindata } from "../path.js";
import { encodeVibe } from "./naiApi.js";

const VIBE_DIR = path.join(plugindata, "vibes");

function ensureDir() {
    if (!fs.existsSync(VIBE_DIR)) {
        fs.mkdirSync(VIBE_DIR, { recursive: true });
    }
}

function getVibePath(name) {
    return path.join(VIBE_DIR, `${name}.json`);
}

/**
 * 保存画风（通过 NovelAI API 编码为 vibe 特征数据）
 * @param {string} name - 画风名称
 * @param {string} imageBase64 - 图片 base64 数据
 * @param {object} options - 可选参数
 * @param {number} options.strength - 参考强度 (0-1)，默认 0.6
 * @param {number} options.informationExtracted - 信息提取量 (0-1)，默认 0.7
 */
export async function saveVibe(name, imageBase64, options = {}) {
    ensureDir();
    const encodedVibe = await encodeVibe(imageBase64);

    const data = {
        name,
        image: encodedVibe,
        strength: options.strength ?? 0.6,
        informationExtracted: options.informationExtracted ?? 0.7,
        createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(getVibePath(name), JSON.stringify(data), "utf-8");
}

/**
 * 获取画风
 * @param {string} name - 画风名称
 * @returns {object|null} 画风数据
 */
export function getVibe(name) {
    const filePath = getVibePath(name);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * 删除画风
 * @param {string} name - 画风名称
 * @returns {boolean} 是否删除成功
 */
export function deleteVibe(name) {
    const filePath = getVibePath(name);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
}

/**
 * 列出所有画风
 * @returns {Array<{name: string, strength: number, informationExtracted: number, createdAt: string}>}
 */
export function listVibes() {
    ensureDir();
    const files = fs.readdirSync(VIBE_DIR).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
        const data = JSON.parse(
            fs.readFileSync(path.join(VIBE_DIR, f), "utf-8"),
        );
        return {
            name: data.name,
            strength: data.strength,
            informationExtracted: data.informationExtracted,
            createdAt: data.createdAt,
        };
    });
}
