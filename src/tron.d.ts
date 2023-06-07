declare module "tronweb" {
  interface ContructorOptions {
    fullHost: string;
    headers?: Record<string, string>;
    privateKey?: string;
  }

  interface Block {
    readonly blockID: string;
    readonly block_header: {
      readonly raw_data: {
        readonly number: number;
        readonly txTrieRoot: string;
        readonly witness_address: string;
        readonly parentHash: string;
        readonly version: number;
        readonly timestamp: number;
      }
      readonly witness_signature: string;
    }
  }

  export default class TronWeb {
    constructor(options: ContructorOptions): TronWeb;

    trx: {
      getCurrentBlock: () => Promise<Block>;
    };

    on(eventName: string, callback: (...args: any[]) => void)
  }
}
