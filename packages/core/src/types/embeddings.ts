export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  dimensions?: number;
  user?: string;
}

export interface Embedding {
  object: "embedding";
  embedding: number[];
  index: number;
}

export interface EmbeddingUsage {
  prompt_tokens: number;
  total_tokens: number;
}

export interface EmbeddingResponse {
  object: "list";
  data: Embedding[];
  model: string;
  usage: EmbeddingUsage;
}
