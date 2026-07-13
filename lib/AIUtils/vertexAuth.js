import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { plugindata } from "../path.js";

export const VERTEX_ADC_DIR = path.join(plugindata, "vertex-adc");
export const DEFAULT_VERTEX_LOCATION = "global";

export function ensureVertexAdcDirectory() {
  fs.mkdirSync(VERTEX_ADC_DIR, { recursive: true });
  return VERTEX_ADC_DIR;
}

export function getManagedVertexCredentialPath(reference) {
  const normalized = String(reference || "").trim();
  if (!normalized || !/^[a-zA-Z0-9._-]+$/.test(normalized)) return null;
  const filePath = path.join(VERTEX_ADC_DIR, `${normalized}.json`);
  return fs.existsSync(filePath) ? filePath : null;
}

function getExistingFilePath(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = path.resolve(candidate.trim());
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

export function getVertexAdcFilePath(config = {}) {
  const managedReference = config.serviceAccountRef || config.credentialRef;
  if (managedReference) return getManagedVertexCredentialPath(managedReference);

  const explicitPath = getExistingFilePath(
    config.gcsCredentialsFile,
    config.vertexCredentialsFile,
    config.googleApplicationCredentials,
    config.keyFilename
  );
  if (explicitPath) return explicitPath;

  if (fs.existsSync(VERTEX_ADC_DIR)) {
    const firstJsonFile = fs
      .readdirSync(VERTEX_ADC_DIR)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .sort()[0];
    if (firstJsonFile) return path.join(VERTEX_ADC_DIR, firstJsonFile);
  }

  return getExistingFilePath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export function readJsonCredentialFile(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function getVertexAdcConfig(config = {}) {
  const filePath = getVertexAdcFilePath(config);
  const credentials = readJsonCredentialFile(filePath);
  const project =
    config.project ||
    config.vertexProject ||
    config.gcsProjectId ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    credentials?.project_id;
  const location =
    config.location ||
    config.vertexLocation ||
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_VERTEX_LOCATION ||
    DEFAULT_VERTEX_LOCATION;

  if (!filePath || !project) return null;
  return { filePath, project, location };
}

export function buildGeminiClientOptions(config = {}) {
  const options = {};
  const baseURL = String(config.baseURL || config.baseUrl || "").trim();
  const apiKey = String(config.apiKey || "").trim();

  if (config.vertex === true || config.vertexai === true) {
    options.vertexai = true;
    const adcConfig = getVertexAdcConfig(config);
    if (!adcConfig) {
      throw new Error(
        `Vertex ADC 凭证不可用，请将服务账号 JSON 放入 ${VERTEX_ADC_DIR}，并确保包含 project_id。`
      );
    }
    options.project = adcConfig.project;
    options.location = adcConfig.location;
    options.googleAuthOptions = { keyFilename: adcConfig.filePath };
  } else {
    if (!apiKey) throw new Error("Gemini API Key 不能为空。");
    options.apiKey = apiKey;
  }

  if (baseURL) options.httpOptions = { baseUrl: baseURL };
  return options;
}

export function createGeminiClient(config = {}) {
  return new GoogleGenAI(buildGeminiClientOptions(config));
}
