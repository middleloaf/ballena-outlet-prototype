// Image helpers shared by the Worker and the local importer.

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"];
export const IMAGE_KINDS = ["foto", "flyer_es", "flyer_en"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const CODE_RE = /^BO-\d{5}$/;

/** Detect the image type from its first bytes; the filename is not trusted. */
export function sniffImage(bytes) {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: ".png" };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: "image/gif", ext: ".gif" };
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp" };
  if (ascii(4, 8) === "ftyp" && /avi[fs]/.test(ascii(8, 12))) return { mime: "image/avif", ext: ".avif" };
  return null;
}

/** Bytes that hold metadata (before the pixel data), so pixels can't false-match. */
function metadataRegion(b) {
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      if (marker === 0xda) return b.subarray(0, i); // start of scan
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return b.subarray(0, Math.min(b.length, 1 << 16));
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    let i = 8;
    while (i + 8 < b.length) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      if (String.fromCharCode(...b.subarray(i + 4, i + 8)) === "IDAT") return b.subarray(0, i);
      i += 12 + len;
    }
  }
  return b.subarray(0, Math.min(b.length, 1 << 16));
}

/**
 * Find a BO-xxxxx code stamped into image metadata (EXIF ImageDescription /
 * UserComment, XMP, PNG text). Codes printed in the pixels need a human or a
 * vision model; WhatsApp and Instagram strip metadata.
 */
export function codeFromImage(bytes) {
  const region = metadataRegion(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  let text = "";
  for (let i = 0; i < region.length; i += 8192) text += String.fromCharCode(...region.subarray(i, i + 8192));
  const m = /BO-\d{5}(?!\d)/i.exec(text) || /BO-\d{5}(?!\d)/i.exec(text.replace(/\0/g, ""));
  return m ? m[0].toUpperCase() : null;
}

export async function sha1Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
