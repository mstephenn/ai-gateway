export interface HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export const fetchHttpClient: HttpClient = {
  fetch: (url, init) => fetch(url, init),
};
