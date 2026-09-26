import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "../idl/prism.json";

export const PRISM_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || (idl as { address?: string }).address || "6cD9BZG2bddZZ1xoNReLVEvdYVaxpxY97F7MfZyov7XW"
);

export const CONFIG_DISCRIMINATOR = Buffer.from([155, 12, 170, 224, 30, 250, 204, 130]);

export function configPda(programId: PublicKey = PRISM_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config_v3")], programId);
}

export function getRpcEndpoints(activeEndpoint?: string): string[] {
  const envRpcUrl = import.meta.env.VITE_SOLANA_RPC_URL;
  const relativeProxy = typeof window !== "undefined" ? "/rpc" : undefined;
  const originProxy = typeof window !== "undefined" ? `${window.location.origin}/rpc` : undefined;

  const list = [
    relativeProxy,
    originProxy,
    activeEndpoint,
    envRpcUrl,
    "https://api.devnet.solana.com",
  ];

  return Array.from(new Set(list.filter((url): url is string => Boolean(url && url.trim().length > 0))));
}

export interface PrismAuthorityFetchResult {
  authority: PublicKey;
  endpoint: string;
  method: "anchor" | "json-rpc";
  accountFound: boolean;
  ownerValid: boolean;
  discValid: boolean;
  rawError?: string;
}

let cachedPrismAuthorityResult: PrismAuthorityFetchResult | null = null;

export async function fetchPrismAuthority(
  activeEndpoint?: string,
  forceRefresh = false
): Promise<PrismAuthorityFetchResult> {
  if (!forceRefresh && cachedPrismAuthorityResult) {
    console.log(
      "[PRISM ADMIN RPC] Returning cached authority result instantly:",
      cachedPrismAuthorityResult.authority.toBase58()
    );
    return cachedPrismAuthorityResult;
  }

  const endpoints = getRpcEndpoints(activeEndpoint);
  const [confPda] = configPda(PRISM_PROGRAM_ID);

  let lastDiagnosticError = "";

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    console.log(`[PRISM ADMIN RPC] Trying RPC (${i + 1}/${endpoints.length}): ${endpoint}`);

    // Method A: Fast direct HTTP JSON-RPC getAccountInfo with 4000ms timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [confPda.toBase58(), { encoding: "base64" }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as any;
      if (json.error) {
        throw new Error(`RPC Error: ${json.error.message || JSON.stringify(json.error)}`);
      }

      const value = json.result?.value;
      if (!value) {
        throw new Error("AUTHORITY_NOT_FOUND: Config PDA account does not exist on this network.");
      }

      const ownerPk = new PublicKey(value.owner);
      if (!ownerPk.equals(PRISM_PROGRAM_ID)) {
        throw new Error(`CONFIGURATION_ERROR: Config PDA exists but is owned by a different program (${ownerPk.toBase58()}).`);
      }

      const dataArray = value.data;
      if (!dataArray || !dataArray[0]) {
        throw new Error("INVALID_AUTHORITY_ACCOUNT: Config account data missing.");
      }

      const buf = Buffer.from(dataArray[0], "base64");
      if (buf.length < 40) {
        throw new Error(`INVALID_AUTHORITY_ACCOUNT: Account data length invalid (${buf.length} bytes, expected >= 40).`);
      }

      const disc = buf.subarray(0, 8);
      if (!CONFIG_DISCRIMINATOR.equals(disc)) {
        throw new Error("INVALID_AUTHORITY_ACCOUNT: Anchor discriminator mismatch.");
      }

      const authority = new PublicKey(buf.subarray(8, 40));
      console.log(
        `[PRISM ADMIN RPC] Direct JSON-RPC success (${endpoint}) -> Authority: ${authority.toBase58()}`
      );
      cachedPrismAuthorityResult = {
        authority,
        endpoint,
        method: "json-rpc",
        accountFound: true,
        ownerValid: true,
        discValid: true,
      };
      return cachedPrismAuthorityResult;
    } catch (directErr: any) {
      clearTimeout(timer);
      lastDiagnosticError = directErr?.message || String(directErr);
      console.warn(`[PRISM ADMIN RPC] Direct fetch failed on ${endpoint}:`, lastDiagnosticError);
    }

    // Method B: Anchor fallback with 4000ms timeout
    try {
      const conn = new Connection(endpoint, { commitment: "confirmed" });
      const readOnlyProvider = new AnchorProvider(
        conn,
        {
          publicKey: PublicKey.default,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any) => txs,
        },
        { commitment: "confirmed" }
      );
      const readOnlyProgram = new Program(idl as never, readOnlyProvider);

      const fetchPromise = (readOnlyProgram.account as any).config.fetch(confPda);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Anchor fetch timed out (4000ms)")), 4000)
      );

      const confData = (await Promise.race([fetchPromise, timeoutPromise])) as any;
      if (confData && confData.authority) {
        const authority = new PublicKey(confData.authority);
        console.log(
          `[PRISM ADMIN RPC] Anchor fetch success (${endpoint}) -> Authority: ${authority.toBase58()}`
        );
        cachedPrismAuthorityResult = {
          authority,
          endpoint,
          method: "anchor",
          accountFound: true,
          ownerValid: true,
          discValid: true,
        };
        return cachedPrismAuthorityResult;
      }
    } catch (anchorErr: any) {
      lastDiagnosticError = anchorErr?.message || String(anchorErr);
      console.warn(`[PRISM ADMIN RPC] Anchor fetch failed on ${endpoint}:`, lastDiagnosticError);
    }
  }

  throw new Error(lastDiagnosticError || "All RPC endpoints failed to load PRISM config authority.");
}
