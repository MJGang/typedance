export type HarnessWorkspaceSearchResult = {
  uri: string;
  score: number;
  snippet: string;
};

export type HarnessWorkspaceAdapter = {
  readText(uri: string): Promise<string> | string;
  search(query: string): Promise<HarnessWorkspaceSearchResult[]> | HarnessWorkspaceSearchResult[];
};

const missingWorkspaceAdapter: HarnessWorkspaceAdapter = {
  readText: () => {
    throw new Error("Harness workspace adapter is not configured");
  },
  search: () => {
    throw new Error("Harness workspace adapter is not configured");
  },
};

export class HarnessWorkspaceService {
  #adapter: HarnessWorkspaceAdapter;

  constructor(adapter: HarnessWorkspaceAdapter = missingWorkspaceAdapter) {
    this.#adapter = adapter;
  }

  readText(uri: string): Promise<string> | string {
    return this.#adapter.readText(uri);
  }

  search(query: string): Promise<HarnessWorkspaceSearchResult[]> | HarnessWorkspaceSearchResult[] {
    return this.#adapter.search(query);
  }
}
