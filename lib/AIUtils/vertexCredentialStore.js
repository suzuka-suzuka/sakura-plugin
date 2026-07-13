import fs from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_VERTEX_LOCATION,
  VERTEX_ADC_DIR,
  ensureVertexAdcDirectory,
  readJsonCredentialFile,
} from "./vertexAuth.js";

const MAX_CREDENTIAL_BYTES = 64 * 1024;
const REQUIRED_FIELDS = [
  "project_id",
  "client_email",
  "private_key",
  "token_uri",
];

export function validateVertexCredentialStructure(credential) {
  if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
    throw new Error("凭据必须是 JSON 对象");
  }
  if (credential.type !== "service_account") {
    throw new Error("凭据 type 必须为 service_account");
  }
  for (const field of REQUIRED_FIELDS) {
    if (typeof credential[field] !== "string" || !credential[field].trim()) {
      throw new Error(`凭据缺少字段：${field}`);
    }
  }
  try {
    createPrivateKey(credential.private_key);
  } catch {
    throw new Error("private_key 不是有效的 PEM 私钥");
  }
  return credential;
}

function credentialMetadata(reference, credential, extra = {}) {
  return {
    reference,
    projectId: credential.project_id,
    clientEmail: credential.client_email,
    type: credential.type,
    ...extra,
  };
}

function slug(value, fallback) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function buildReference(credential) {
  const accountName = String(credential.client_email).split("@")[0];
  const digest = createHash("sha256")
    .update(`${credential.project_id}\0${credential.client_email}\0${credential.private_key_id || ""}`)
    .digest("hex")
    .slice(0, 10);
  return `${slug(credential.project_id, "vertex")}-${slug(accountName, "service")}-${digest}`;
}

export async function verifyVertexCredential(credential, options = {}) {
  validateVertexCredentialStructure(credential);
  const location = String(options.location || DEFAULT_VERTEX_LOCATION).trim() || DEFAULT_VERTEX_LOCATION;
  const client = new GoogleGenAI({
    vertexai: true,
    project: credential.project_id,
    location,
    googleAuthOptions: { credentials: credential },
  });
  const pager = await client.models.list({
    config: {
      pageSize: 1,
      abortSignal: AbortSignal.timeout(20000),
    },
  });
  let modelCount = 0;
  for await (const model of pager) {
    if (model) modelCount++;
    break;
  }
  if (modelCount === 0) throw new Error("认证成功，但 Vertex 没有返回可用模型");
  return { location, modelCount };
}

export async function importVertexCredential(credential, options = {}) {
  const serialized = JSON.stringify(credential);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CREDENTIAL_BYTES) {
    throw new Error(`凭据文件不能超过 ${MAX_CREDENTIAL_BYTES / 1024} KB`);
  }
  validateVertexCredentialStructure(credential);
  const verification = await verifyVertexCredential(credential, options);
  ensureVertexAdcDirectory();
  const reference = buildReference(credential);
  const targetPath = path.join(VERTEX_ADC_DIR, `${reference}.json`);
  if (!fs.existsSync(targetPath)) {
    const tempPath = `${targetPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, targetPath);
  }
  return credentialMetadata(reference, credential, {
    location: verification.location,
    validation: "verified",
  });
}

export function listVertexCredentials() {
  ensureVertexAdcDirectory();
  return fs
    .readdirSync(VERTEX_ADC_DIR)
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .sort()
    .map((file) => {
      const reference = path.basename(file, path.extname(file));
      const credential = readJsonCredentialFile(path.join(VERTEX_ADC_DIR, file));
      try {
        validateVertexCredentialStructure(credential);
        return credentialMetadata(reference, credential, { validation: "structure_valid" });
      } catch (error) {
        return {
          reference,
          validation: "invalid",
          error: error.message,
        };
      }
    });
}
