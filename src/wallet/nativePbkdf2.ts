// src/wallet/nativePbkdf2.ts
//
// Ported (typed) from mango-mobile's own src/wallet/nativePbkdf2.js —
// thin wrapper around the Pbkdf2Module native module (see
// android/app/src/main/java/com/mangoprotocol/pro/Pbkdf2Module.kt for
// the full rationale and the cross-check proving it produces byte-
// identical output to walletCipher.ts's pure-JS @noble path for the
// same password/salt/iterations, including non-ASCII passwords).
//
// Deliberately its own file, importing 'react-native' at the top —
// walletCipher.ts itself must stay resolvable under plain Node (see
// that file's own header) for any offline crypto verification script,
// so it never imports this module directly; vault.ts calls
// tryNativePbkdf2Sha256 directly instead, which safely resolves to
// null under any environment where the native module is unavailable
// rather than throwing.
//
// Returns null (never throws) on any failure — missing module, a
// device where the native call errors, anything — so callers always
// have a safe pure-JS fallback path. This is a speed optimization,
// never a hard dependency: worst case on failure is the exact same
// behavior the app already had before this file existed.

import {NativeModules} from 'react-native';

export async function tryNativePbkdf2Sha256(
  password: string,
  saltBytes: Uint8Array,
  iterations: number,
  keyLengthBytes: number,
): Promise<Uint8Array | null> {
  const native = NativeModules.Pbkdf2Module;
  if (!native || typeof native.deriveSha256 !== 'function') {
    return null;
  }
  try {
    const saltBase64 = Buffer.from(saltBytes).toString('base64');
    const resultBase64 = await native.deriveSha256(password, saltBase64, iterations, keyLengthBytes);
    return new Uint8Array(Buffer.from(resultBase64, 'base64'));
  } catch {
    return null;
  }
}
