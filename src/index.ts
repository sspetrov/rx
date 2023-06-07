import { JsonRpcProvider, Provider } from 'ethers';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  concatMap,
  from,
  interval,
  map,
  of,
} from 'rxjs';
import { Client } from 'bitcoin-simple-rpc';
import TronWeb from 'tronweb';

enum Network {
  Ethereum = 'ethereum',
  Bitcoin = 'bitcoin',
  Tron = 'tron',
}

interface RpcProvider {
  getRecentBlockNumber(): Promise<number>;
  watchBlocks$: Observable<number>;
}

class EthersRpcProvider implements RpcProvider {
  readonly #provider: Provider;

  constructor(connectionUrl: string) {
    this.#provider = new JsonRpcProvider(connectionUrl);
  }

  async getRecentBlockNumber(): Promise<number> {
    return this.#provider.getBlockNumber();
  }

  get watchBlocks$(): Observable<number> {
    return new Observable((subscriber) => {
      this.#provider.on('block', (blockNumber: number) => {
        console.log('new block', blockNumber);

        subscriber.next(blockNumber);
      });
    });
  }
}

class BitcoinRpcProvider implements RpcProvider {
  readonly #bitcoinClient: Client;

  constructor(connectionUrl: string) {
    const { origin, username, password } = new URL(connectionUrl);

    this.#bitcoinClient = new Client({
      baseURL: origin,
      auth: { username, password },
    });
  }

  async getRecentBlockNumber(): Promise<number> {
    return this.#bitcoinClient.getBlockCount();
  }

  get watchBlocks$(): Observable<number> {
    return interval(1000 * 60 * 3).pipe(concatMap(() => from(this.getRecentBlockNumber())));
  }
}

class TronRpcProvider implements RpcProvider {
  readonly #tronWeb: TronWeb;

  constructor(connectionUrl: string) {
    this.#tronWeb = new TronWeb({ fullHost: connectionUrl });
  }

  async getRecentBlockNumber(): Promise<number> {
    const block = await this.#tronWeb.trx.getCurrentBlock();

    return block.block_header.raw_data.number;
  }

  get watchBlocks$(): Observable<number> {
    return interval(5000).pipe(concatMap(() => from(this.getRecentBlockNumber())));
  }
}

interface Sequence<T> {
  readonly sequence$: Observable<T>;
}

interface ControlledSequence<T> extends Sequence<T> {
  proceed(): void;
}

class BlockEmitter implements Sequence<number> {
  readonly #sequence$: Observable<number>;

  constructor(provider: RpcProvider) {
    this.#sequence$ = provider.watchBlocks$;
  }

  get sequence$() {
    return this.#sequence$;
  }
}

class BlockSequence implements ControlledSequence<number> {
  readonly #current$: BehaviorSubject<number>;
  readonly #next$: BehaviorSubject<number>;
  readonly #sequence$: Observable<number>;

  constructor(blockEmitter: Sequence<number>, from: number) {
    this.#current$ = new BehaviorSubject(from);
    this.#next$ = new BehaviorSubject(from);
    this.#sequence$ = combineLatest([this.#current$, this.#next$, blockEmitter.sequence$]).pipe(
      concatMap(([current, next, max]) => {
        if (!this.isAvailableSequence(current, next, max)) return EMPTY;

        this.#next$.next(current + 1);

        return of(current);
      }),
    );
  }

  get sequence$(): Observable<number> {
    return this.#sequence$;
  }

  proceed(): void {
    const { value: next } = this.#next$;
    const { value: current } = this.#current$;

    if (next !== current) this.#current$.next(next);
  }

  isAvailableSequence(current: number, next: number, max: number): boolean {
    return current === next && current <= max;
  }
}

interface Block {
  readonly blockNumber: number;
  accept(): void;
}

class BlockImpl implements Block {
  readonly #blockNumber: number;
  readonly #sequence: ControlledSequence<number>;

  constructor(blockNumber: number, sequence: ControlledSequence<number>) {
    this.#blockNumber = blockNumber;
    this.#sequence = sequence;
  }

  get blockNumber() {
    return this.#blockNumber;
  }

  accept(): void {
    this.#sequence.proceed();
  }
}

const tronProvider = new TronRpcProvider('https://api.shasta.trongrid.io');

const blockSequence$ = from(tronProvider.getRecentBlockNumber()).pipe(
  concatMap((lastBlock) => {
    const blockEmitter = new BlockEmitter(tronProvider);

    const blockSequence = new BlockSequence(blockEmitter, lastBlock);

    return blockSequence.sequence$.pipe(
      map((blockNumber) => new BlockImpl(blockNumber, blockSequence)),
    );
  }),
);

blockSequence$.subscribe((block) => {
  setTimeout(() => {
    block.accept();
  }, 1000);
});
