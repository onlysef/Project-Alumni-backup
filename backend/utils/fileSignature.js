// Filename extensions are just a client-supplied string — trivially spoofed.
// This checks the file's actual leading bytes against the real format's
// magic number, so a file merely *named* report.xlsx with arbitrary content
// inside gets rejected before it ever reaches the parser.
//
// .xlsx and .docx are both ZIP containers (only their internal entries
// differ), so they share the same outer signature — distinguishing them
// would mean inspecting the zip's entry list, which is more than this check
// is trying to do. .csv is plain text with no reliable magic number, so it
// is intentionally not checked here (extension is the only signal there is).
const SIGNATURES = {
  xlsx: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  docx: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  xls:  [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  pdf:  [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
};

function matchesFileSignature(buffer, ext) {
  const signatures = SIGNATURES[ext.toLowerCase()];
  if (!signatures) return true; // no known signature for this extension (e.g. csv) — nothing to check
  return signatures.some((bytes) => bytes.every((byte, i) => buffer[i] === byte));
}

module.exports = { matchesFileSignature };
