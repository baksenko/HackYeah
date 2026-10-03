// In-process test harness: LiteSVM instead of a validator, so tests can move
// the clock to any time instead of sleeping until deadlines pass.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { createHash } from "crypto";
import fs from "fs";
import { Clock, LiteSVM } from "litesvm";
import path from "path";

import { LiteSVMProvider, addr, readAccount } from "./provider";

import type { Fundraiser } from "../../target/types/fundraiser";

/** The program workspace; tests run from `program/` (npm test / anchor test). */
const WORKSPACE = process.cwd();
const IDL = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "target/idl/fundraiser.json"), "utf8"));

/** Mirrors USDC_MINT for localnet builds (constants.rs): sha256("chip-in:localnet-test-usdc:v1"). */
export const TEST_USDC_MINT = Keypair.fromSeed(
  createHash("sha256").update("chip-in:localnet-test-usdc:v1").digest()
).publicKey;
export const USDC_DECIMALS = 6;
/** 1 USDC in base units. */
export const USDC = 10 ** USDC_DECIMALS;

/** Mint authority for every test token mint. */
export const MINT_AUTHORITY = Keypair.generate();

/** A realistic start time, so deadlines look like real dates in logs. */
const START = 1_790_000_000n;

export type Harness = ReturnType<typeof createHarness>;

export function createHarness() {
  const svm = new LiteSVM();
  // The freshly built program, at the address its IDL declares.
  svm.addProgramFromFile(addr(IDL.address), path.join(WORKSPACE, "target/deploy/fundraiser.so"));
  const provider = new LiteSVMProvider(svm);
  const program = new Program<Fundraiser>(IDL as Fundraiser, provider);

  const rentExempt = (size: number) => svm.minimumBalanceForRentExemption(BigInt(size));
  const writeAccount = (address: PublicKey, data: Buffer, owner: PublicKey) =>
    svm.setAccount({
      address: addr(address),
      data,
      executable: false,
      lamports: rentExempt(data.length),
      programAddress: addr(owner),
      space: BigInt(data.length),
    } as never);

  const setTime = (unixTimestamp: bigint) => {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unixTimestamp));
    // A fresh blockhash, so an identical transaction sent again is a new one
    // instead of being rejected as already processed.
    svm.expireBlockhash();
  };
  setTime(START);

  const h = {
    svm,
    provider,
    program,

    /** Current on-chain unix time. */
    now: () => Number(svm.getClock().unixTimestamp),

    /** Moves the chain clock forward by `seconds`. No waiting. */
    warp: (seconds: number) => setTime(svm.getClock().unixTimestamp + BigInt(seconds)),

    /** A fresh blockhash without moving time, to resend an identical transaction. */
    newBlockhash: () => svm.expireBlockhash(),

    /** A new keypair holding `sol` SOL for fees and rent. */
    wallet(sol = 10): Keypair {
      const kp = Keypair.generate();
      svm.airdrop(addr(kp.publicKey), BigInt(sol * LAMPORTS_PER_SOL) as never);
      return kp;
    },

    /**
     * Writes a token mint straight into the SVM at `address` -- the only way to
     * have one at the fixed TEST_USDC_MINT address the program expects.
     */
    createMint(address: PublicKey = Keypair.generate().publicKey, decimals = USDC_DECIMALS): PublicKey {
      const data = Buffer.alloc(MINT_SIZE);
      MintLayout.encode(
        {
          mintAuthorityOption: 1,
          mintAuthority: MINT_AUTHORITY.publicKey,
          supply: 0n,
          decimals,
          isInitialized: true,
          freezeAuthorityOption: 0,
          freezeAuthority: PublicKey.default,
        },
        data
      );
      writeAccount(address, data, TOKEN_PROGRAM_ID);
      return address;
    },

    /**
     * Gives `owner` an associated token account for `mint` holding `amount`
     * base units (written directly, like a faucet). Returns its address.
     */
    fundTokens(owner: PublicKey, amount: number | bigint, mint: PublicKey = TEST_USDC_MINT): PublicKey {
      const ata = getAssociatedTokenAddressSync(mint, owner, true);
      const data = Buffer.alloc(ACCOUNT_SIZE);
      AccountLayout.encode(
        {
          mint,
          owner,
          amount: BigInt(amount),
          delegateOption: 0,
          delegate: PublicKey.default,
          state: 1, // initialized
          isNativeOption: 0,
          isNative: 0n,
          delegatedAmount: 0n,
          closeAuthorityOption: 0,
          closeAuthority: PublicKey.default,
        },
        data
      );
      writeAccount(ata, data, TOKEN_PROGRAM_ID);
      return ata;
    },

    /** Token balance of a token account, in base units (0 if it does not exist). */
    tokenBalance(tokenAccount: PublicKey): bigint {
      const info = readAccount(svm, tokenAccount);
      if (!info) return 0n;
      return AccountLayout.decode(Buffer.from(info.data)).amount;
    },

    /** Events emitted by the last successful transaction, decoded with the IDL. */
    events(): { name: string; data: any }[] {
      const parser = new anchor.EventParser(program.programId, new anchor.BorshCoder(program.idl));
      return [...parser.parseLogs(provider.lastLogs)];
    },

    lamports: (address: PublicKey) => BigInt(svm.getBalance(addr(address)) ?? 0n),
    exists: (address: PublicKey) => readAccount(svm, address) !== null,
  };

  h.createMint(TEST_USDC_MINT);
  return h;
}

/** Asserts the program rejected the call with a specific named error. */
export async function expectError(p: Promise<unknown>, name: string) {
  try {
    await p;
  } catch (e: any) {
    const text = [e.error?.errorCode?.code, e.message, ...(e.logs ?? e.transactionLogs ?? [])].join(" ");
    assert.include(text, name, `expected ${name}, got: ${text.slice(0, 600)}`);
    return;
  }
  assert.fail(`expected the program to reject this with ${name}, but it succeeded`);
}

export { anchor };
