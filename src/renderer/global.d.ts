export {};

declare global {
  interface Window {
    electronAPI: {
      getAllPatients: (filters: any) => Promise<any[]>;
    };
  }
}
