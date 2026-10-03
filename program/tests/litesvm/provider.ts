// A minimal Anchor `Provider` backed by LiteSVM 1.x.
//
// LiteSVM 1.x speaks @solana/kit types, while this project's Anchor client
// uses @solana/web3.js v1. This bridges the two: transactions are built and
// signed with web3.js, then handed to LiteSVM as raw bytes; account reads come
// back as web3.js `AccountInfo`. Only what Anchor actually calls is covered.
import * as anchor from "@coral-xyz/anchor";
import {
  AccountInfo,
  Connection,
  GetProgramAccountsFilter,
  Keypair,
  PublicKey,
  SendTransactionError,
  Signer,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

const { bs58 } = anchor.utils.bytes;

/** kit's `Address` is a branded string; a base58 string is the same value. */
export const addr = (key: PublicKey | string) => (typeof key === "string" ? key : key.toBase58()) as never;

/** Reads an account from LiteSVM as a web3.js `AccountInfo`, or null if missing. */
export function readAccount(svm: LiteSVM, key: PublicKey): AccountInfo<Buffer> | null {
  const acct = svm.getAccount(addr(key)) as any;
  if (!acct || acct.exists === false) return null;
  return {
    data: Buffer.from(acct.data),
    executable: acct.executable,
    lamports: Number(acct.lamports),
    owner: new PublicKey(acct.programAddress),
    rentEpoch: 0,
  };
}

function matches(data: Buffer, filters: GetProgramAccountsFilter[] = []): boolean {
  return filters.every((f) => {
    if ("dataSize" in f) return data.length === f.dataSize;
    const bytes = Buffer.from(bs58.decode(f.memcmp.bytes));
    return data.subarray(f.memcmp.offset, f.memcmp.offset + bytes.length).equals(bytes);
  });
}

/** The slice of `Connection` that Anchor's `Program` uses for reads. */
function liteConnection(svm: LiteSVM) {
  const slot = () => Number(svm.getClock().slot);
  return {
    commitment: "confirmed",
    rpcEndpoint: "litesvm",
    getAccountInfo: async (key: PublicKey) => readAccount(svm, key),
    getAccountInfoAndContext: async (key: PublicKey) => ({ context: { slot: slot() }, value: readAccount(svm, key) }),
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => readAccount(svm, k)),
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({
      context: { slot: slot() },
      value: keys.map((k) => readAccount(svm, k)),
    }),
    getProgramAccounts: async (programId: PublicKey, config?: { filters?: GetProgramAccountsFilter[] }) =>
      (svm.getProgramAccounts(addr(programId)) as any[])
        .map((a) => ({ pubkey: new PublicKey(a.address), account: readAccount(svm, new PublicKey(a.address))! }))
        .filter((a) => a.account && matches(a.account.data, config?.filters)),
    getBalance: async (key: PublicKey) => Number(svm.getBalance(addr(key)) ?? 0n),
    getMinimumBalanceForRentExemption: async (len: number) => Number(svm.minimumBalanceForRentExemption(BigInt(len))),
    getLatestBlockhash: async () => ({ blockhash: String(svm.latestBlockhash()), lastValidBlockHeight: slot() + 150 }),
    getSlot: async () => slot(),
  };
}

export class LiteSVMProvider implements anchor.Provider {
  readonly connection: Connection;
  readonly wallet: anchor.Wallet;
  readonly publicKey: PublicKey;
  /** Logs of the last successful transaction, for reading emitted events. */
  lastLogs: string[] = [];

  constructor(readonly svm: LiteSVM, payer: Keypair = Keypair.generate()) {
    this.wallet = new anchor.Wallet(payer);
    this.publicKey = payer.publicKey;
    this.connection = liteConnection(svm) as unknown as Connection;
    svm.airdrop(addr(payer.publicKey), 1_000_000_000_000n as never);
  }

  async sendAndConfirm(tx: Transaction | VersionedTransaction, signers: Signer[] = []): Promise<string> {
    if (tx instanceof VersionedTransaction) {
      tx.message.recentBlockhash = String(this.svm.latestBlockhash());
      tx.sign(signers);
      return this.submit(tx.serialize(), true);
    }
    tx.feePayer ??= this.wallet.publicKey;
    tx.recentBlockhash = String(this.svm.latestBlockhash());
    if (signers.length) tx.partialSign(...signers);
    // Sign as the fee payer only when the payer is actually a required signer.
    if (tx.feePayer.equals(this.wallet.publicKey)) await this.wallet.signTransaction(tx);
    return this.submit(tx.serialize(), false);
  }

  send(tx: Transaction | VersionedTransaction, signers?: Signer[]) {
    return this.sendAndConfirm(tx, signers);
  }

  async sendAll(txs: { tx: Transaction | VersionedTransaction; signers?: Signer[] }[]) {
    const out: string[] = [];
    for (const { tx, signers } of txs) out.push(await this.sendAndConfirm(tx, signers));
    return out;
  }

  private submit(raw: Uint8Array, versioned: boolean): string {
    // The public `sendTransaction` takes @solana/kit objects; the native layer
    // takes the serialized bytes we already have.
    const inner = (this.svm as any).inner;
    const res = versioned ? inner.sendVersionedTransaction(raw) : inner.sendLegacyTransaction(raw);
    if (res instanceof FailedTransactionMetadata) {
      const logs = res.meta().logs();
      throw new SendTransactionError({
        action: "send",
        signature: bs58.encode(res.meta().signature()),
        transactionMessage: String(res.err()),
        logs,
      });
    }
    this.lastLogs = res.logs();
    return bs58.encode(res.signature());
  }
}
