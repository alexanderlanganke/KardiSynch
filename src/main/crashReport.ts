const REPO = 'alexanderlanganke/KardiSynch';
const MAX_URL_LENGTH = 8000; // browsers truncate around 8k–10k

/**
 * Replace lone surrogate halves (e.g. produced by slicing through an emoji)
 * with U+FFFD so encodeURIComponent cannot throw "URI malformed" — the crash
 * reporter itself must never crash.
 */
function sanitizeSurrogates(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

export function buildGitHubIssueUrl(opts: {
  errorMessage: string;
  stack?: string;
  source: string;
  appVersion?: string;
  electronVersion?: string;
  platform?: string;
}): string {
  const title = `Crash: ${sanitizeSurrogates(opts.errorMessage.slice(0, 100))}`;

  let body = `## Crash Report

**Source:** ${opts.source}
**App version:** ${opts.appVersion ?? 'unknown'}
**Electron:** ${opts.electronVersion ?? 'unknown'}
**Platform:** ${opts.platform ?? 'unknown'}

### Error
\`\`\`
${opts.errorMessage}
\`\`\`

### Stack trace
\`\`\`
${opts.stack ?? 'No stack trace available'}
\`\`\`

### Steps to reproduce
<!-- Please describe what you were doing when this crash occurred -->

`;

  // Truncate body if the resulting URL would be too long. The limit is
  // enforced on the ENCODED length — non-ASCII content expands well beyond
  // the old 3x assumption — by shrinking the raw slice until it fits.
  const baseUrl = `https://github.com/${REPO}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=`;
  const maxBodyLength = MAX_URL_LENGTH - baseUrl.length;
  let encodedBody = encodeURIComponent(sanitizeSurrogates(body));
  if (encodedBody.length > maxBodyLength) {
    const suffix = '\n\n[truncated — full details in log file]';
    let keep = Math.floor(maxBodyLength / 3);
    do {
      encodedBody = encodeURIComponent(sanitizeSurrogates(body.slice(0, keep)) + suffix);
      keep = Math.floor(keep / 2);
    } while (encodedBody.length > maxBodyLength && keep > 0);
  }

  return baseUrl + encodedBody;
}
