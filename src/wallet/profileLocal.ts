// src/wallet/profileLocal.ts
//
// Real, local-only bio and avatar for ProfileScreen — replacing the
// "Coming soon" alerts both used to show. Mango Pro has no backend
// account system (see ProfileScreen.tsx's own header): there is nowhere
// server-side to upload a photo to or store a bio against, so both live
// entirely on this device, keyed by the account's own EVM address so a
// second wallet created or imported later on the same device never
// inherits the first one's bio/photo.
//
// The avatar is stored as a self-contained `data:` URI (the picker's own
// includeBase64 output, ProfileScreen.tsx's handlePickAvatar builds the
// URI) — the actual image bytes live in AsyncStorage itself, not a
// separate file path. A saved file path was the first draft here, but a
// picked photo's own URI (content://, ph://) is only a grant scoped to
// that pick, and even a copy into cache can be reclaimed by the OS under
// storage pressure — genuinely temporary in a way a permanently-saved
// profile photo shouldn't be. Storing the bytes directly in the same
// durable store this app already trusts for everything else (trade
// history, watchlist, vault) means there is no separate file for
// anything to reclaim — no second native filesystem dependency needed
// either, since the picker's own quality/maxWidth/maxHeight options
// (set at pick time in ProfileScreen.tsx) already keep the encoded
// string a reasonable size without any custom compression code.

import AsyncStorage from '@react-native-async-storage/async-storage';

const BIO_KEY_PREFIX = 'mango_pro_profile_bio_v1:';
const AVATAR_KEY_PREFIX = 'mango_pro_profile_avatar_v1:';

function keyFor(prefix: string, address: string): string {
  return `${prefix}${address.toLowerCase()}`;
}

export async function getBio(address: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(keyFor(BIO_KEY_PREFIX, address))) ?? '';
  } catch {
    return '';
  }
}

export async function setBio(address: string, bio: string): Promise<void> {
  const key = keyFor(BIO_KEY_PREFIX, address);
  try {
    const trimmed = bio.trim();
    if (trimmed) {
      await AsyncStorage.setItem(key, trimmed);
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    // Best-effort, same as every other local-only store in this app —
    // a failed write here loses a bio edit, never the wallet itself.
  }
}

export async function getAvatarUri(address: string): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(keyFor(AVATAR_KEY_PREFIX, address))) || null;
  } catch {
    return null;
  }
}

export async function setAvatarUri(address: string, uri: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(AVATAR_KEY_PREFIX, address), uri);
  } catch {
    // Best-effort — same reasoning as setBio above.
  }
}

export async function clearAvatar(address: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(AVATAR_KEY_PREFIX, address)).catch(() => {});
}
