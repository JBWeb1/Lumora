// Bridges to the installed Android app (apps/android, built with Capacitor).
//
// Android's in-app browser can't save `<a download>` links, so exports would silently do
// nothing there. In the Android app we write the file to the app's cache and open the
// system share sheet instead, where the user picks "Save to Files", Drive, email, etc.
// In a normal browser (and the desktop app) none of this runs.

const capacitor = () => globalThis.Capacitor;

/** True inside the installed Android app. */
export function isNativeApp() {
  return Boolean(capacitor()?.isNativePlatform?.());
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Save a file through the Android share sheet. Resolves false when not in the app. */
export async function saveFileNative(fileName, blob) {
  const cap = capacitor();
  if (!isNativeApp() || !cap.nativePromise) return false;
  const data = await blobToBase64(blob);
  const { uri } = await cap.nativePromise('Filesystem', 'writeFile', { path: fileName, data, directory: 'CACHE' });
  try {
    await cap.nativePromise('Share', 'share', { title: fileName, files: [uri], dialogTitle: `Save ${fileName}` });
  } catch (err) {
    // Closing the share sheet without choosing anything isn't an error worth showing.
    if (!/cancel/i.test(String(err?.message ?? err))) throw err;
  }
  return true;
}
