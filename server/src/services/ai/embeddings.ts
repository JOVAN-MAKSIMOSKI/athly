import { GoogleGenerativeAI } from '@google/generative-ai';

const EMBEDDINGS_PROVIDER = process.env.EMBEDDINGS_PROVIDER || 'google'; // 'google' | 'ollama' | 'local'
const DEFAULT_EMBEDDING_MODEL =
  process.env.GOOGLE_EMBEDDING_MODEL || process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

// Ollama configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

const LOCAL_EMBEDDING_DIM = 384;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function hashToken(token: string): number {
  let hash = 5381;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) + hash) ^ token.charCodeAt(index);
  }
  return hash >>> 0;
}

function l2Normalize(values: number[]): number[] {
  const sumSquares = values.reduce((sum, value) => sum + value * value, 0);
  const magnitude = Math.sqrt(sumSquares);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return values;
  return values.map((value) => value / magnitude);
}

function embedTextLocally(text: string): number[] {
  const vector = Array.from({ length: LOCAL_EMBEDDING_DIM }, () => 0);
  const tokens = tokenize(text);

  if (tokens.length === 0) return vector;

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % LOCAL_EMBEDDING_DIM;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }

  return l2Normalize(vector);
}

function embedTextsLocally(texts: string[]): number[][] {
  return texts.map((text) => embedTextLocally(text));
}

async function embedTextsWithOllama(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];

  for (const text of texts) {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OLLAMA_EMBEDDING_MODEL,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API returned status ${response.status}`);
      }

      const data = (await response.json()) as { embedding?: number[] };

      if (!data.embedding || data.embedding.length === 0) {
        throw new Error('Ollama API returned an empty embedding');
      }

      vectors.push(data.embedding);
    } catch (error) {
      throw new Error(
        `Failed to embed text with Ollama (${OLLAMA_EMBEDDING_MODEL}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return vectors;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allowLocalFallback = process.env.EMBEDDINGS_ALLOW_LOCAL_FALLBACK !== 'false';

  // Try the configured provider first
  if (EMBEDDINGS_PROVIDER === 'ollama') {
    try {
      console.log(`[embeddings] Using Ollama with model "${OLLAMA_EMBEDDING_MODEL}"`);
      return await embedTextsWithOllama(texts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[embeddings] Ollama embedding failed: ${message}`);

      if (allowLocalFallback) {
        console.warn('[embeddings] Falling back to local deterministic embeddings.');
        return embedTextsLocally(texts);
      }

      throw error;
    }
  }

  // Default: use Google Generative AI
  let genAi: GoogleGenerativeAI;
  try {
    function resolveApiKey(): string {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY) for embeddings');
      }
      return apiKey;
    }

    genAi = new GoogleGenerativeAI(resolveApiKey());
  } catch (error) {
    if (allowLocalFallback) {
      console.warn('[embeddings] API key missing. Falling back to local deterministic embeddings.');
      return embedTextsLocally(texts);
    }
    throw error;
  }

  function resolveEmbeddingModel(): string {
    return DEFAULT_EMBEDDING_MODEL.replace(/^models\//, '');
  }

  function resolveCandidateModels(): string[] {
    const requested = resolveEmbeddingModel();
    const fallbacks = ['gemini-embedding-001', 'text-embedding-004', 'embedding-001'];
    return [requested, ...fallbacks.filter((model) => model !== requested)];
  }

  async function embedWithModel(modelName: string): Promise<number[][]> {
    const model = genAi.getGenerativeModel({ model: modelName });
    const vectors: number[][] = [];

    for (const text of texts) {
      const response = await model.embedContent(text);
      const values = response.embedding?.values;

      if (!values || values.length === 0) {
        throw new Error('Embedding API returned an empty vector');
      }

      vectors.push(values);
    }

    return vectors;
  }

  const candidates = resolveCandidateModels();
  const failures: string[] = [];
  for (const modelName of candidates) {
    try {
      if (modelName !== candidates[0]) {
        console.warn(`[embeddings] Falling back to model "${modelName}".`);
      }
      return await embedWithModel(modelName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${modelName}: ${message}`);
      const unavailable = /not found|not supported|404/i.test(message);
      if (!unavailable) {
        throw error;
      }
    }
  }

  if (allowLocalFallback) {
    console.warn(
      `[embeddings] No compatible remote embedding model available. Falling back to local deterministic embeddings. Details: ${failures.join(' | ')}`
    );
    return embedTextsLocally(texts);
  }

  throw new Error(`No compatible embedding model was available for this API key. Tried: ${failures.join(' | ')}`);
}
